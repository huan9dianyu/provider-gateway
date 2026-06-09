import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeConfig } from '../src/config.js';

test('normalizes enabled providers by active provider first then priority', () => {
  const config = normalizeConfig({
    server: { host: '127.0.0.1', port: 8787 },
    activeProvider: 'backup',
    requestTimeoutMs: 12000,
    failoverStatusCodes: [429, 500, 502, 503, 504],
    providers: [
      {
        name: 'primary',
        baseUrl: 'https://primary.example/v1',
        apiKey: 'key-primary',
        enabled: true,
        priority: 1,
      },
      {
        name: 'backup',
        baseUrl: 'https://backup.example/v1',
        apiKey: 'key-backup',
        enabled: true,
        priority: 2,
      },
    ],
  });

  assert.equal(config.activeProvider, 'backup');
  assert.deepEqual(config.logging, { enabled: true });
  assert.deepEqual(
    config.providers.map((provider) => provider.name),
    ['primary', 'backup'],
  );
});

test('normalizes diagnostic logging switch', () => {
  const config = normalizeConfig({
    activeProvider: 'primary',
    logging: { enabled: false },
    providers: [
      { name: 'primary', baseUrl: 'https://a.example/v1', apiKey: 'a' },
    ],
  });

  assert.deepEqual(config.logging, { enabled: false });
});

test('rejects duplicate provider names', () => {
  assert.throws(
    () =>
      normalizeConfig({
        activeProvider: 'primary',
        providers: [
          { name: 'primary', baseUrl: 'https://a.example/v1', apiKey: 'a' },
          { name: 'primary', baseUrl: 'https://b.example/v1', apiKey: 'b' },
        ],
      }),
    /Duplicate provider name: primary/,
  );
});

test('rejects active provider that is missing or disabled', () => {
  assert.throws(
    () =>
      normalizeConfig({
        activeProvider: 'missing',
        providers: [
          { name: 'primary', baseUrl: 'https://a.example/v1', apiKey: 'a' },
        ],
      }),
    /Active provider must reference an enabled provider/,
  );

  assert.throws(
    () =>
      normalizeConfig({
        activeProvider: 'primary',
        providers: [
          {
            name: 'primary',
            baseUrl: 'https://a.example/v1',
            apiKey: 'a',
            enabled: false,
          },
        ],
      }),
    /Active provider must reference an enabled provider/,
  );
});
