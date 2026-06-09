import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProviderRuntimeState } from '../src/provider-state.js';

test('ProviderRuntimeState pins fallback provider until cooldown expires', () => {
  let now = 1_000;
  const state = new ProviderRuntimeState({
    fallbackRetryDelayMs: 600_000,
    now: () => now,
  });

  state.pinFallback('backup', 'primary');

  assert.equal(state.currentProviderName('primary'), 'backup');
  assert.equal(state.snapshot('primary').mode, 'fallback');
  assert.equal(state.snapshot('primary').retryAt, new Date(601_000).toISOString());

  now = 601_001;

  assert.equal(state.currentProviderName('primary'), 'primary');
  assert.equal(state.snapshot('primary').mode, 'primary');
});

test('ProviderRuntimeState notifies when fallback cooldown recovers to primary', () => {
  let timerCallback = null;
  const recoveries = [];
  const state = new ProviderRuntimeState({
    fallbackRetryDelayMs: 600_000,
    now: () => 1_000,
    setTimer: (callback) => {
      timerCallback = callback;
      return null;
    },
    clearTimer: () => {},
    onFallbackRecovered: (event) => recoveries.push(event),
  });

  state.pinFallback('backup', 'primary');
  timerCallback();

  assert.deepEqual(recoveries, [
    {
      fromProvider: 'backup',
      toProvider: 'primary',
    },
  ]);
  assert.equal(state.currentProviderName('primary'), 'primary');
});

test('ProviderRuntimeState does not notify recovery for manual reset', () => {
  const recoveries = [];
  const state = new ProviderRuntimeState({
    onFallbackRecovered: (event) => recoveries.push(event),
  });

  state.pinFallback('backup', 'primary');
  state.reset();

  assert.deepEqual(recoveries, []);
});

test('ProviderRuntimeState does not pin when selected provider is primary', () => {
  const state = new ProviderRuntimeState();

  state.pinFallback('primary', 'primary');

  assert.equal(state.currentProviderName('primary'), 'primary');
  assert.equal(state.snapshot('primary').mode, 'primary');
});

test('ProviderRuntimeState resets when manual primary changes', () => {
  const state = new ProviderRuntimeState();

  state.pinFallback('backup', 'primary');
  state.reset();

  assert.equal(state.currentProviderName('primary'), 'primary');
  assert.equal(state.snapshot('primary').mode, 'primary');
});

test('ProviderRuntimeState advances from failed primary to first backup', () => {
  const state = new ProviderRuntimeState();
  const next = state.advanceAfterFailure({
    activeProvider: 'primary',
    providers: [
      { name: 'primary', enabled: true, priority: 1 },
      { name: 'backup-a', enabled: true, priority: 2 },
      { name: 'backup-b', enabled: true, priority: 3 },
    ],
  }, 'primary');

  assert.equal(next, 'backup-a');
  assert.equal(state.currentProviderName('primary'), 'backup-a');
});

test('ProviderRuntimeState advances from failed backup to next backup', () => {
  const state = new ProviderRuntimeState();
  const config = {
    activeProvider: 'primary',
    providers: [
      { name: 'primary', enabled: true, priority: 1 },
      { name: 'backup-a', enabled: true, priority: 2 },
      { name: 'backup-b', enabled: true, priority: 3 },
    ],
  };

  state.advanceAfterFailure(config, 'primary');
  const next = state.advanceAfterFailure(config, 'backup-a');

  assert.equal(next, 'backup-b');
  assert.equal(state.currentProviderName('primary'), 'backup-b');
});
