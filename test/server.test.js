import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createGatewayServer } from '../src/server.js';

async function writeTempConfig(overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'provider-gateway-'));
  const configPath = path.join(dir, 'providers.local.json');
  const baseConfig = {
    server: { host: '127.0.0.1', port: 8787 },
    activeProvider: 'primary',
    requestTimeoutMs: 5000,
    failoverStatusCodes: [429, 500, 502, 503, 504],
    providers: [
      {
        name: 'primary',
        baseUrl: 'https://primary.example/v1',
        apiKey: 'primary-key',
        enabled: true,
        priority: 1,
      },
      {
        name: 'backup',
        baseUrl: 'https://backup.example/v1',
        apiKey: 'backup-key',
        enabled: true,
        priority: 2,
      },
    ],
  };
  const config = {
    ...baseConfig,
    ...overrides,
    server: {
      ...baseConfig.server,
      ...(overrides.server || {}),
    },
    providers: overrides.providers || baseConfig.providers,
  };
  await writeFile(
    configPath,
    JSON.stringify(config, null, 2),
  );
  return configPath;
}

async function withServer(t) {
  const configPath = await writeTempConfig();
  const app = await createGatewayServer({ configPath });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return { app, configPath, baseUrl: app.url };
}

async function waitForLogEvent(logRecords, event) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const record = logRecords.find((entry) => entry.event === event);
    if (record) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

test('GET /api/config returns active config including provider keys for local editing', async (t) => {
  const { baseUrl } = await withServer(t);

  const response = await fetch(`${baseUrl}/api/config`);
  const config = await response.json();

  assert.equal(response.status, 200);
  assert.equal(config.activeProvider, 'primary');
  assert.equal(config.providers[0].apiKey, 'primary-key');
});

test('PUT /api/config persists config and hot-applies active provider', async (t) => {
  const { app, baseUrl, configPath } = await withServer(t);

  const updated = {
    server: { host: '127.0.0.1', port: 8787 },
    activeProvider: 'backup',
    requestTimeoutMs: 8000,
    failoverStatusCodes: [429, 500, 502, 503, 504],
    providers: [
      {
        name: 'primary',
        baseUrl: 'https://primary.example/v1',
        apiKey: 'primary-key',
        enabled: true,
        priority: 1,
      },
      {
        name: 'backup',
        baseUrl: 'https://backup.example/v1',
        apiKey: 'backup-key-updated',
        enabled: true,
        priority: 2,
      },
    ],
  };

  const response = await fetch(`${baseUrl}/api/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updated),
  });
  const body = await response.json();
  const persisted = JSON.parse(await readFile(configPath, 'utf8'));

  assert.equal(response.status, 200);
  assert.equal(body.activeProvider, 'backup');
  assert.equal(app.getConfig().activeProvider, 'backup');
  assert.equal(persisted.providers[1].apiKey, 'backup-key-updated');
});

test('POST /api/active-provider switches provider immediately and persists it', async (t) => {
  const { app, baseUrl, configPath } = await withServer(t);

  const response = await fetch(`${baseUrl}/api/active-provider`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'backup' }),
  });
  const body = await response.json();
  const persisted = JSON.parse(await readFile(configPath, 'utf8'));

  assert.equal(response.status, 200);
  assert.equal(body.activeProvider, 'backup');
  assert.equal(app.getConfig().activeProvider, 'backup');
  assert.equal(persisted.activeProvider, 'backup');
});

test('POST /v1/responses forwards request body as a buffer to upstream fetch', async (t) => {
  const configPath = await writeTempConfig();
  const requestPayload = { model: 'gpt-5.5', input: 'hello' };
  const requestBody = JSON.stringify(requestPayload);
  const upstreamCalls = [];
  const app = await createGatewayServer({
    configPath,
    fetchImpl: async (url, init) => {
      upstreamCalls.push({
        url,
        isBuffer: Buffer.isBuffer(init.body),
        bodyText: Buffer.isBuffer(init.body) ? init.body.toString('utf8') : null,
        hasPipe: typeof init.body?.pipe === 'function',
      });
      return new Response('{"id":"resp_primary"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(upstreamCalls, [
    {
      url: 'https://primary.example/v1/responses',
      isBuffer: true,
      bodyText: requestBody,
      hasPipe: false,
    },
  ]);
});

test('POST /v1/responses emits diagnostic logs without leaking secrets', async (t) => {
  const configPath = await writeTempConfig();
  const logRecords = [];
  const app = await createGatewayServer({
    configPath,
    logger: (record) => logRecords.push(record),
    fetchImpl: async () => {
      return new Response('{"id":"resp_primary"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer local-secret',
      'content-type': 'application/json',
      referer: 'https://codex.local/session?token=referer-secret',
      'user-agent': 'CodexDiagnosticTest/1.0',
    },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'secret body text' }),
  });

  assert.equal(response.status, 200);
  await response.text();

  const events = logRecords
    .map((record) => record.event)
    .filter((event) => event.startsWith('responses.'));
  for (const event of [
    'responses.request_start',
    'responses.body_read',
    'responses.upstream_start',
    'responses.upstream_headers',
    'responses.stream_start',
    'responses.stream_complete',
    'responses.response_finish',
  ]) {
    assert.ok(events.includes(event), `missing log event: ${event}`);
  }
  assert.ok(logRecords.every((record) => record.requestId));
  const serializedLogs = JSON.stringify(logRecords);
  assert.doesNotMatch(serializedLogs, /local-secret/);
  assert.doesNotMatch(serializedLogs, /primary-key/);
  assert.doesNotMatch(serializedLogs, /secret body text/);
  assert.doesNotMatch(serializedLogs, /referer-secret/);
  assert.match(serializedLogs, /CodexDiagnosticTest\/1\.0/);
  assert.match(serializedLogs, /https:\/\/codex\.local\/session/);
});

test('POST /v1/responses can inspect request hints without logging full prompt', async (t) => {
  const configPath = await writeTempConfig();
  const logRecords = [];
  const app = await createGatewayServer({
    configPath,
    inspectRequests: true,
    logger: (record) => logRecords.push(record),
    fetchImpl: async () => {
      return new Response('{"id":"resp_primary"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer local-secret',
      cookie: 'session=secret-cookie',
      'content-type': 'application/json',
      'x-codex-workspace': '/Users/huangdianyu/java-project/aigc/llm',
    },
    body: JSON.stringify({
      model: 'gpt-5.5',
      input: 'do not log this secret prompt /Users/huangdianyu/java-project/aigc/llm',
    }),
  });

  assert.equal(response.status, 200);
  await response.text();

  const inspectRecord = logRecords.find((record) => record.event === 'responses.request_inspect');
  assert.ok(inspectRecord);
  assert.deepEqual(inspectRecord.bodyTopLevelKeys, ['model', 'input']);
  assert.equal(inspectRecord.headers.authorization, '[redacted]');
  assert.equal(inspectRecord.headers.cookie, '[redacted]');
  assert.equal(
    inspectRecord.headers['x-codex-workspace'],
    '/Users/huangdianyu/java-project/aigc/llm',
  );
  assert.ok(
    inspectRecord.suspectedPaths.includes('/Users/huangdianyu/java-project/aigc/llm'),
  );

  const serializedLogs = JSON.stringify(logRecords);
  assert.doesNotMatch(serializedLogs, /local-secret/);
  assert.doesNotMatch(serializedLogs, /secret-cookie/);
  assert.doesNotMatch(serializedLogs, /do not log this secret prompt/);
});

test('POST /v1/responses does not inspect request hints by default', async (t) => {
  const configPath = await writeTempConfig();
  const logRecords = [];
  const app = await createGatewayServer({
    configPath,
    logger: (record) => logRecords.push(record),
    fetchImpl: async () => {
      return new Response('{"id":"resp_primary"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: '/Users/example/project' }),
  });

  assert.equal(response.status, 200);
  await response.text();
  assert.equal(
    logRecords.some((record) => record.event === 'responses.request_inspect'),
    false,
  );
});

test('POST /v1/responses suppresses diagnostic logs when logging is disabled', async (t) => {
  const configPath = await writeTempConfig({ logging: { enabled: false } });
  const logRecords = [];
  const app = await createGatewayServer({
    configPath,
    logger: (record) => logRecords.push(record),
    fetchImpl: async () => {
      return new Response('{"id":"resp_primary"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello' }),
  });

  assert.equal(response.status, 200);
  await response.text();
  assert.deepEqual(logRecords, []);
});

test('POST /v1/responses streams upstream chunks without buffering full response', async (t) => {
  const configPath = await writeTempConfig();
  const upstreamEvents = [];
  const app = await createGatewayServer({
    configPath,
    fetchImpl: async () => {
      let secondChunkTimer;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'));
            secondChunkTimer = setTimeout(() => {
              upstreamEvents.push('second-sent');
              controller.enqueue(new TextEncoder().encode('data: second\n\n'));
              controller.close();
            }, 150);
          },
          cancel() {
            clearTimeout(secondChunkTimer);
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello', stream: true }),
  });
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  const firstText = new TextDecoder().decode(firstChunk.value);

  assert.equal(response.status, 200);
  assert.equal(firstText, 'data: first\n\n');
  assert.deepEqual(upstreamEvents, []);

  await reader.cancel();
});

test('upstream stream errors do not crash the gateway process', async (t) => {
  const configPath = await writeTempConfig();
  const app = await createGatewayServer({
    configPath,
    fetchImpl: async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'));
            setTimeout(() => {
              controller.error(new Error('upstream stream terminated'));
            }, 10);
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello', stream: true }),
  });

  assert.equal(response.status, 200);
  await assert.rejects(() => response.text());

  const statusResponse = await fetch(`${app.url}/api/status`);
  assert.equal(statusResponse.status, 200);
});

test('upstream stream errors include provider and request id in diagnostic logs', async (t) => {
  const configPath = await writeTempConfig();
  const logRecords = [];
  const app = await createGatewayServer({
    configPath,
    logger: (record) => logRecords.push(record),
    fetchImpl: async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'));
            setTimeout(() => {
              controller.error(new Error('upstream stream terminated'));
            }, 10);
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello', stream: true }),
  });

  assert.equal(response.status, 200);
  await assert.rejects(() => response.text());

  const streamError = await waitForLogEvent(logRecords, 'responses.stream_error');
  assert.ok(streamError);
  assert.equal(streamError.provider, 'primary');
  assert.equal(streamError.status, 200);
  assert.equal(typeof streamError.requestId, 'string');
  assert.match(streamError.error, /upstream stream terminated|terminated/);
});

test('non-stream provider failure advances runtime provider for the next request', async (t) => {
  const configPath = await writeTempConfig();
  let now = 1_000;
  const calls = [];
  const app = await createGatewayServer({
    configPath,
    runtimeStateOptions: {
      fallbackRetryDelayMs: 500,
      now: () => now,
      setTimer: () => null,
      clearTimer: () => {},
    },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('primary')) {
        return new Response('primary failed', { status: 500 });
      }
      return new Response('{"id":"resp_backup"}', { status: 200 });
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello' }),
  });
  let status = await (await fetch(`${app.url}/api/status`)).json();

  assert.equal(status.runtime.mode, 'fallback');
  assert.equal(status.runtime.currentProvider, 'backup');
  assert.deepEqual(calls, ['https://primary.example/v1/responses']);

  await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello again' }),
  });

  assert.deepEqual(calls, [
    'https://primary.example/v1/responses',
    'https://backup.example/v1/responses',
  ]);

  now = 1_501;
  await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'after retry delay' }),
  });
  status = await (await fetch(`${app.url}/api/status`)).json();

  assert.equal(status.runtime.mode, 'fallback');
  assert.deepEqual(calls, [
    'https://primary.example/v1/responses',
    'https://backup.example/v1/responses',
    'https://primary.example/v1/responses',
  ]);
});

test('provider failure notifies backend failover listener', async (t) => {
  const configPath = await writeTempConfig();
  const notifications = [];
  const app = await createGatewayServer({
    configPath,
    failoverNotifier: (event) => {
      notifications.push(event);
      return true;
    },
    fetchImpl: async () => new Response('primary failed', { status: 500 }),
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello' }),
  });
  await response.text();

  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0], {
    type: 'failover',
    activeProvider: 'primary',
    fromProvider: 'primary',
    toProvider: 'backup',
    status: 500,
  });
});

test('fallback cooldown recovery notifies backend listener', async (t) => {
  const configPath = await writeTempConfig();
  let timerCallback = null;
  const notifications = [];
  const app = await createGatewayServer({
    configPath,
    runtimeStateOptions: {
      fallbackRetryDelayMs: 500,
      setTimer: (callback) => {
        timerCallback = callback;
        return null;
      },
      clearTimer: () => {},
    },
    failoverNotifier: (event) => {
      notifications.push(event);
      return true;
    },
    fetchImpl: async () => new Response('primary failed', { status: 500 }),
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  const response = await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello' }),
  });
  await response.text();
  timerCallback();

  assert.deepEqual(notifications, [
    {
      type: 'failover',
      activeProvider: 'primary',
      fromProvider: 'primary',
      toProvider: 'backup',
      status: 500,
    },
    {
      type: 'recovered',
      activeProvider: 'primary',
      fromProvider: 'backup',
      toProvider: 'primary',
    },
  ]);
});

test('stream status failure advances runtime provider for the next request', async (t) => {
  const configPath = await writeTempConfig();
  const app = await createGatewayServer({
    configPath,
    fetchImpl: async (url) => {
      if (url.includes('primary')) {
        return new Response('primary failed', { status: 500 });
      }
      return new Response('data: ok\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close({ force: true }));

  await fetch(`${app.url}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', input: 'hello', stream: true }),
  });
  const status = await (await fetch(`${app.url}/api/status`)).json();

  assert.equal(status.runtime.mode, 'fallback');
  assert.equal(status.runtime.currentProvider, 'backup');
});
