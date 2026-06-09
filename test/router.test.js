import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProviderUrl,
  orderedProviders,
  proxyResponsesRequest,
} from '../src/router.js';

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
      baseUrl: 'https://backup.example/api',
      apiKey: 'backup-key',
      enabled: true,
      priority: 2,
    },
  ],
};

test('buildProviderUrl joins provider base URL with Codex Responses suffix', () => {
  assert.equal(
    buildProviderUrl('https://provider.example/v1', '/v1/responses'),
    'https://provider.example/v1/responses',
  );
  assert.equal(
    buildProviderUrl('https://provider.example/custom', '/v1/responses'),
    'https://provider.example/custom/responses',
  );
});

test('orderedProviders tries active provider first then enabled providers by priority', () => {
  const providers = orderedProviders({
    ...baseConfig,
    activeProvider: 'backup',
  });

  assert.deepEqual(
    providers.map((provider) => provider.name),
    ['backup', 'primary'],
  );
});

test('orderedProviders tries runtime pinned provider before configured active provider', () => {
  const providers = orderedProviders(baseConfig, 'backup');

  assert.deepEqual(
    providers.map((provider) => provider.name),
    ['backup', 'primary'],
  );
});

test('proxyResponsesRequest returns primary response when active provider succeeds', async () => {
  const calls = [];
  const result = await proxyResponsesRequest(
    baseConfig,
    {
      method: 'POST',
      path: '/v1/responses',
      headers: { 'content-type': 'application/json', authorization: 'Bearer local' },
      body: Buffer.from('{"input":"hello"}'),
    },
    async (url, init) => {
      calls.push({ url, init });
      return new Response('{"id":"resp_primary"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );

  assert.equal(result.provider.name, 'primary');
  assert.equal(result.response.status, 200);
  assert.equal(await result.response.text(), '{"id":"resp_primary"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://primary.example/v1/responses');
  assert.equal(calls[0].init.headers.authorization, 'Bearer primary-key');
});

test('proxyResponsesRequest returns primary failure and signals provider advance', async () => {
  const calls = [];
  const result = await proxyResponsesRequest(
    baseConfig,
    {
      method: 'POST',
      path: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"input":"hello"}'),
    },
    async (url) => {
      calls.push(url);
      return new Response('primary failed', { status: 500 });
    },
  );

  assert.equal(result.provider.name, 'primary');
  assert.equal(result.response.status, 500);
  assert.equal(await result.response.text(), 'primary failed');
  assert.deepEqual(calls, ['https://primary.example/v1/responses']);
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.provider),
    ['primary'],
  );
  assert.equal(result.shouldAdvanceProvider, true);
});

test('proxyResponsesRequest uses pinned fallback directly during cooldown', async () => {
  const calls = [];
  const result = await proxyResponsesRequest(
    baseConfig,
    {
      method: 'POST',
      path: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"input":"hello"}'),
      currentProviderName: 'backup',
    },
    async (url) => {
      calls.push(url);
      return new Response('{"id":"resp_backup"}', { status: 200 });
    },
  );

  assert.equal(result.provider.name, 'backup');
  assert.deepEqual(calls, ['https://backup.example/api/responses']);
  assert.equal(result.shouldAdvanceProvider, false);
});

test('proxyResponsesRequest signals provider advance for status failures', async () => {
  const result = await proxyResponsesRequest(
    baseConfig,
    {
      method: 'POST',
      path: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"input":"hello","stream":true}'),
    },
    async (url) => {
      assert.equal(url, 'https://primary.example/v1/responses');
      return new Response('stream failed', {
        status: 500,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  );

  assert.equal(result.provider.name, 'primary');
  assert.equal(result.shouldAdvanceProvider, true);
});

test('proxyResponsesRequest does not fail over on non-failover status code', async () => {
  const result = await proxyResponsesRequest(
    baseConfig,
    {
      method: 'POST',
      path: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"input":"hello"}'),
    },
    async () => new Response('bad request', { status: 400 }),
  );

  assert.equal(result.provider.name, 'primary');
  assert.equal(result.response.status, 400);
  assert.equal(result.attempts.length, 1);
});
