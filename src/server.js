import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { ensureLocalConfig, readConfig, writeConfig } from './config.js';
import { ProviderRuntimeState } from './provider-state.js';
import { proxyResponsesRequest } from './router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, '../public');
const MAX_LOG_VALUE_LENGTH = 240;

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function truncateForLog(value, maxLength = MAX_LOG_VALUE_LENGTH) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function safeUrlForLog(value) {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(String(value));
    return `${url.origin}${url.pathname}`;
  } catch {
    return truncateForLog(value);
  }
}

function safeIncomingHeaders(headers) {
  return compactObject({
    accept: truncateForLog(headers.accept),
    contentLength: truncateForLog(headers['content-length']),
    contentType: truncateForLog(headers['content-type']),
    origin: safeUrlForLog(headers.origin),
    referer: safeUrlForLog(headers.referer),
    userAgent: truncateForLog(headers['user-agent']),
  });
}

function errorForLog(error) {
  if (!(error instanceof Error)) {
    return { error: String(error) };
  }

  return compactObject({
    error: error.message,
    errorName: error.name,
    errorCode: error.code,
    cause: error.cause instanceof Error ? error.cause.message : undefined,
    causeCode: error.cause?.code,
  });
}

function notifyFailover(failoverNotifier, event, log) {
  if (typeof failoverNotifier !== 'function') {
    return;
  }

  try {
    const sent = failoverNotifier(event);
    if (sent) {
      const logEvent = event.type === 'recovered'
        ? 'responses.recovery_notification'
        : 'responses.failover_notification';
      log('info', logEvent, event);
    }
  } catch (error) {
    log('warn', 'responses.failover_notification_error', errorForLog(error));
  }
}

async function failureReasonForNotification(response, failedAttempt) {
  if (failedAttempt?.error) {
    return failedAttempt.error;
  }
  if (!response) {
    return undefined;
  }
  try {
    const text = await response.clone().text();
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}

function defaultLogger(record) {
  const line = `[provider-gateway] ${JSON.stringify(record)}`;
  if (record.level === 'error' || record.level === 'warn') {
    console.error(line);
    return;
  }
  console.log(line);
}

function emitLog(logger, level, event, fields = {}) {
  const record = compactObject({
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  });

  try {
    if (typeof logger === 'function') {
      logger(record);
      return;
    }
    if (typeof logger?.[level] === 'function') {
      logger[level](`[provider-gateway] ${JSON.stringify(record)}`);
      return;
    }
    if (typeof logger?.log === 'function') {
      logger.log(`[provider-gateway] ${JSON.stringify(record)}`);
    }
  } catch {
    // Logging must never break request handling.
  }
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function readJsonBody(request) {
  const body = await readBody(request);
  if (body.length === 0) {
    return {};
  }
  return JSON.parse(body.toString('utf8'));
}

async function sendWebResponse(nodeResponse, webResponse, { log = () => {}, provider } = {}) {
  const headers = {};
  for (const [key, value] of webResponse.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== 'content-encoding' && lowerKey !== 'content-length') {
      headers[key] = value;
    }
  }
  nodeResponse.writeHead(webResponse.status, headers);

  if (!webResponse.body) {
    log('info', 'responses.stream_empty', {
      provider,
      status: webResponse.status,
    });
    nodeResponse.end();
    return;
  }

  let responseBytes = 0;
  const byteCounter = new Transform({
    transform(chunk, _encoding, callback) {
      responseBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk);
      callback(null, chunk);
    },
  });

  log('info', 'responses.stream_start', {
    provider,
    status: webResponse.status,
    contentType: webResponse.headers.get('content-type') || '',
  });

  try {
    await pipeline(Readable.fromWeb(webResponse.body), byteCounter, nodeResponse);
    log('info', 'responses.stream_complete', {
      provider,
      status: webResponse.status,
      responseBytes,
    });
  } catch (error) {
    log('error', 'responses.stream_error', {
      provider,
      status: webResponse.status,
      responseBytes,
      ...errorForLog(error),
    });
    throw error;
  }
}

function requestPath(request) {
  return new URL(request.url, 'http://127.0.0.1').pathname;
}

function pruneProviderHealth(providerHealth, config) {
  const activeProviderNames = new Set(config.providers.map((provider) => provider.name));
  for (const providerName of providerHealth.keys()) {
    if (!activeProviderNames.has(providerName)) {
      providerHealth.delete(providerName);
    }
  }
}

async function serveAdmin(publicDir, response) {
  const adminPath = path.join(publicDir, 'admin.html');
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  createReadStream(adminPath).pipe(response);
}

export async function createGatewayServer({
  configPath,
  examplePath,
  publicDir = DEFAULT_PUBLIC_DIR,
  fetchImpl = fetch,
  runtimeStateOptions,
  logger = defaultLogger,
  failoverNotifier = null,
} = {}) {
  if (configPath && examplePath) {
    await ensureLocalConfig({ configPath, examplePath });
  } else if (!configPath) {
    await ensureLocalConfig();
  }

  let config = await readConfig(configPath);
  const onFallbackRecovered = runtimeStateOptions?.onFallbackRecovered;
  const runtimeState = new ProviderRuntimeState({
    ...runtimeStateOptions,
    onFallbackRecovered: (event) => {
      if (typeof onFallbackRecovered === 'function') {
        onFallbackRecovered(event);
      }
      notifyFailover(
        failoverNotifier,
        {
          type: 'recovered',
          activeProvider: event.toProvider,
          ...event,
        },
        (level, eventName, fields = {}) => {
          if (config.logging?.enabled === false) {
            return;
          }
          emitLog(logger, level, eventName, fields);
        },
      );
    },
  });
  const providerHealth = new Map();
  const sockets = new Set();

  const server = http.createServer(async (request, response) => {
    const pathName = requestPath(request);
    const requestId = randomUUID();
    const startedAtMs = Date.now();
    const isResponsesRequest = request.method === 'POST' && pathName === '/v1/responses';
    let responseFinished = false;
    const log = (level, event, fields = {}) => {
      if (!isResponsesRequest || config.logging?.enabled === false) {
        return;
      }
      emitLog(logger, level, event, {
        requestId,
        method: request.method,
        path: pathName,
        durationMs: Date.now() - startedAtMs,
        ...fields,
      });
    };

    if (isResponsesRequest) {
      log('info', 'responses.request_start', {
        remoteAddress: request.socket.remoteAddress,
        remotePort: request.socket.remotePort,
        headers: safeIncomingHeaders(request.headers),
      });
      request.on('aborted', () => {
        log('warn', 'responses.client_aborted', {
          headersSent: response.headersSent,
          statusCode: response.statusCode,
        });
      });
      response.on('finish', () => {
        responseFinished = true;
        log('info', 'responses.response_finish', {
          statusCode: response.statusCode,
        });
      });
      response.on('close', () => {
        if (!responseFinished) {
          log('warn', 'responses.client_closed', {
            headersSent: response.headersSent,
            statusCode: response.statusCode,
            writableEnded: response.writableEnded,
          });
        }
      });
    }

    try {
      if (request.method === 'GET' && (pathName === '/' || pathName === '/admin')) {
        await serveAdmin(publicDir, response);
        return;
      }

      if (request.method === 'GET' && pathName === '/api/config') {
        sendJson(response, 200, config);
        return;
      }

      if (request.method === 'PUT' && pathName === '/api/config') {
        const nextConfig = await readJsonBody(request);
        config = await writeConfig(configPath, nextConfig);
        runtimeState.reset();
        pruneProviderHealth(providerHealth, config);
        sendJson(response, 200, config);
        return;
      }

      if (request.method === 'POST' && pathName === '/api/active-provider') {
        const body = await readJsonBody(request);
        const nextConfig = { ...config, activeProvider: body.name };
        config = await writeConfig(configPath, nextConfig);
        runtimeState.reset();
        pruneProviderHealth(providerHealth, config);
        sendJson(response, 200, config);
        return;
      }

      if (request.method === 'GET' && pathName === '/api/status') {
        sendJson(response, 200, {
          activeProvider: config.activeProvider,
          enabledProviders: config.providers
            .filter((provider) => provider.enabled)
            .map((provider) => provider.name),
          runtime: runtimeState.snapshot(config.activeProvider),
          health: Object.fromEntries(providerHealth),
        });
        return;
      }

      if (request.method === 'POST' && pathName === '/v1/responses') {
        const bodyBuffer = await readBody(request);
        log('info', 'responses.body_read', {
          bodyBytes: bodyBuffer.length,
        });
        const result = await proxyResponsesRequest(
          config,
          {
            method: request.method,
            path: pathName,
            headers: request.headers,
            body: bodyBuffer,
            currentProviderName: runtimeState.currentProviderName(config.activeProvider),
            requestId,
          },
          fetchImpl,
          { log },
        );

        for (const attempt of result.attempts) {
          providerHealth.set(attempt.provider, {
            ...attempt,
            checkedAt: new Date().toISOString(),
          });
        }

        if (result.shouldAdvanceProvider && result.provider) {
          const nextProvider = runtimeState.advanceAfterFailure(config, result.provider.name);
          if (nextProvider) {
            const failedAttempt =
              result.attempts.find((attempt) => attempt.provider === result.provider.name) ||
              result.attempts.at(-1) ||
              {};
            const reason = await failureReasonForNotification(result.response, failedAttempt);
            notifyFailover(
              failoverNotifier,
              compactObject({
                type: 'failover',
                activeProvider: config.activeProvider,
                fromProvider: result.provider.name,
                toProvider: nextProvider,
                status: failedAttempt.status ?? result.response.status,
                reason,
              }),
              log,
            );
          }
        }

        await sendWebResponse(response, result.response, {
          log,
          provider: result.provider?.name || null,
        });
        return;
      }

      sendText(response, 404, 'Not found');
    } catch (error) {
      log('error', 'responses.request_error', {
        headersSent: response.headersSent,
        writableEnded: response.writableEnded,
        ...errorForLog(error),
      });
      if (!response.headersSent) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else if (!response.writableEnded) {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    get url() {
      const address = server.address();
      if (!address || typeof address === 'string') {
        return '';
      }
      return `http://${address.address}:${address.port}`;
    },
    getConfig() {
      return config;
    },
    getRuntimeState() {
      return runtimeState.snapshot(config.activeProvider);
    },
    listen(port = config.server.port, host = config.server.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    close({ force = false } = {}) {
      runtimeState.reset();
      if (force) {
        for (const socket of sockets) {
          socket.destroy();
        }
      }
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export async function readPackageVersion() {
  const packagePath = path.resolve(__dirname, '../package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  return packageJson.version;
}
