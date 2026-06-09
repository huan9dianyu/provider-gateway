import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  removePidFile,
  readPidFile,
  writePidFile,
} from '../src/process-control.js';

test('writePidFile and readPidFile round-trip process metadata', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'provider-gateway-pid-'));
  const pidPath = path.join(dir, 'gateway.pid');

  await writePidFile(pidPath, { pid: 12345, cwd: '/tmp/provider-gateway' });
  const metadata = await readPidFile(pidPath);

  assert.equal(metadata.pid, 12345);
  assert.equal(metadata.cwd, '/tmp/provider-gateway');
  assert.match(metadata.startedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('removePidFile ignores missing pid files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'provider-gateway-pid-'));
  const pidPath = path.join(dir, 'missing.pid');

  await removePidFile(pidPath);
});
