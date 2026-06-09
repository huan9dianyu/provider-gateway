import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { waitForStartedPid } from '../src/daemon-control.js';

test('waitForStartedPid surfaces child exit and recent log output', async () => {
  const child = new EventEmitter();

  const waitPromise = waitForStartedPid({
    child,
    isProcessRunning: () => false,
    readPidFile: async () => {
      throw new Error('pid missing');
    },
    readRecentLog: async () => 'Error: listen EADDRINUSE: address already in use 127.0.0.1:8787',
    timeoutMs: 1000,
    pollMs: 1,
  });

  child.emit('exit', 1, null);

  await assert.rejects(
    waitPromise,
    /Provider Gateway exited before creating a pid file.*EADDRINUSE/s,
  );
});
