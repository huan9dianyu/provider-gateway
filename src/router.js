const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export function buildProviderUrl(baseUrl, requestPath) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const suffix = requestPath.startsWith('/v1/')
    ? requestPath.slice('/v1'.length)
    : requestPath;
  if (suffix.startsWith('/')) {
    return `${normalizedBase}${suffix}`;
  }
  return `${normalizedBase}/${suffix}`;
}

export function orderedProviders(config, currentProviderName = config.activeProvider) {
  const enabledProviders = config.providers
    .filter((provider) => provider.enabled)
    .sort((left, right) => left.priority - right.priority);
  const activeProvider = enabledProviders.find(
    (provider) => provider.name === currentProviderName,
  );

  if (!activeProvider) {
    return enabledProviders;
  }

  return [
    activeProvider,
    ...enabledProviders.filter((provider) => provider.name !== activeProvider.name),
  ];
}

function outboundHeaders(incomingHeaders, provider) {
  const headers = {};
  for (const [key, value] of Object.entries(incomingHeaders || {})) {
    const lowerKey = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lowerKey)) {
      headers[lowerKey] = value;
    }
  }
  headers.authorization = `Bearer ${provider.apiKey}`;
  return headers;
}

function shouldFailover(status, config) {
  return config.failoverStatusCodes.includes(status);
}

function failureResponse(attempts) {
  return new Response(
    JSON.stringify(
      {
        error: {
          message: 'All configured providers failed',
          type: 'provider_gateway_error',
          attempts,
        },
      },
      null,
      2,
    ),
    {
      status: 502,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function safeUrlForLog(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value || '');
  }
}

function errorForLog(error) {
  if (!(error instanceof Error)) {
    return { error: String(error) };
  }

  return {
    error: error.message,
    errorName: error.name,
    errorCode: error.code,
    cause: error.cause instanceof Error ? error.cause.message : undefined,
    causeCode: error.cause?.code,
  };
}

export async function proxyResponsesRequest(
  config,
  request,
  fetchImpl = fetch,
  { log = () => {} } = {},
) {
  if (request.method !== 'POST' || request.path !== '/v1/responses') {
    return {
      provider: null,
      attempts: [],
      response: new Response('Not found', { status: 404 }),
    };
  }

  const primaryProviderName = config.activeProvider;
  const startProviderName = request.currentProviderName || primaryProviderName;
  const providers = orderedProviders(config, startProviderName);
  const attempts = [];
  const provider = providers[0];

  if (!provider) {
    return {
      provider: null,
      attempts,
      shouldAdvanceProvider: false,
      response: failureResponse(attempts),
    };
  }

  const url = buildProviderUrl(provider.baseUrl, request.path);
  const upstream = safeUrlForLog(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    log('warn', 'responses.upstream_timeout', {
      provider: provider.name,
      upstream,
      timeoutMs: config.requestTimeoutMs,
    });
    controller.abort();
  }, config.requestTimeoutMs);

  try {
    log('info', 'responses.upstream_start', {
      provider: provider.name,
      upstream,
      timeoutMs: config.requestTimeoutMs,
    });

    const fetchOptions = {
      method: 'POST',
      headers: outboundHeaders(request.headers, provider),
      body: request.body,
      signal: controller.signal,
    };
    if (request.body && typeof request.body.pipe === 'function') {
      fetchOptions.duplex = 'half';
    }

    const response = await fetchImpl(url, fetchOptions);
    attempts.push({ provider: provider.name, status: response.status });
    log('info', 'responses.upstream_headers', {
      provider: provider.name,
      upstream,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      failover: shouldFailover(response.status, config),
    });

    return {
      provider,
      attempts,
      response,
      shouldAdvanceProvider: shouldFailover(response.status, config),
    };
  } catch (error) {
    attempts.push({
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    log('error', 'responses.upstream_error', {
      provider: provider.name,
      upstream,
      ...errorForLog(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  return {
    provider,
    attempts,
    shouldAdvanceProvider: true,
    response: failureResponse(attempts),
  };
}
