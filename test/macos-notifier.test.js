import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMacOSFailoverNotifier } from '../src/macos-notifier.js';

test('macOS failover notifier sends a system notification without shell execution', () => {
  const calls = [];
  const notify = createMacOSFailoverNotifier({
    platformName: 'darwin',
    execFileImpl: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(null, '', '');
    },
  });

  const sent = notify({
    type: 'failover',
    fromProvider: 'primary',
    toProvider: 'backup',
    status: 500,
  });

  assert.equal(sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/usr/bin/osascript');
  assert.deepEqual(calls[0].args.slice(0, 2), ['-e', calls[0].args[1]]);
  assert.match(calls[0].args[1], /display notification/);
  assert.match(calls[0].args[1], /Provider Gateway/);
  assert.match(calls[0].args[1], /primary -> backup/);
  assert.equal(calls[0].options.shell, false);
});

test('macOS failover notifier labels recovery notifications separately', () => {
  const calls = [];
  const notify = createMacOSFailoverNotifier({
    platformName: 'darwin',
    execFileImpl: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(null, '', '');
    },
  });

  const sent = notify({
    type: 'recovered',
    fromProvider: 'backup',
    toProvider: 'primary',
  });

  assert.equal(sent, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[1], /Provider 已恢复主路由/);
  assert.match(calls[0].args[1], /backup -> primary/);
});

test('macOS failover notifier is disabled outside macOS', () => {
  const calls = [];
  const notify = createMacOSFailoverNotifier({
    platformName: 'linux',
    execFileImpl: (...args) => calls.push(args),
  });

  const sent = notify({
    fromProvider: 'primary',
    toProvider: 'backup',
  });

  assert.equal(sent, false);
  assert.deepEqual(calls, []);
});
