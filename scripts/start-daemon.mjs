import { spawn } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

import { waitForStartedPid } from '../src/daemon-control.js';
import {
  DEFAULT_PID_PATH,
  readPidFile,
  removePidFile,
} from '../src/process-control.js';

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function existingRunningPid() {
  try {
    const metadata = await readPidFile(DEFAULT_PID_PATH);
    if (isProcessRunning(metadata.pid)) {
      return metadata.pid;
    }
    await removePidFile(DEFAULT_PID_PATH);
  } catch {
    return null;
  }
  return null;
}

async function readRecentLog(logPath) {
  try {
    const contents = await readFile(logPath, 'utf8');
    return contents.split('\n').slice(-30).join('\n').trim();
  } catch {
    return '';
  }
}

const runningPid = await existingRunningPid();
if (runningPid) {
  console.log(`Provider Gateway is already running: PID ${runningPid}`);
  process.exit(0);
}

const logsDir = path.resolve('logs');
const logPath = path.join(logsDir, 'provider-gateway.log');
await mkdir(logsDir, { recursive: true });
const logFile = await open(logPath, 'a');

const child = spawn(process.execPath, ['src/index.js'], {
  cwd: process.cwd(),
  detached: true,
  stdio: ['ignore', logFile.fd, logFile.fd],
});
child.unref();

let pid;
try {
  pid = await waitForStartedPid({
    child,
    isProcessRunning,
    readPidFile: () => readPidFile(DEFAULT_PID_PATH),
    readRecentLog: () => readRecentLog(logPath),
  });
} finally {
  await logFile.close();
}

console.log(`Provider Gateway started in background: PID ${pid}`);
console.log('Admin UI: http://127.0.0.1:8787/admin');
console.log(`Log file: ${logPath}`);
