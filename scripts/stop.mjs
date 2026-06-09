import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  DEFAULT_PID_PATH,
  readPidFile,
  removePidFile,
} from '../src/process-control.js';
import {
  commandForPid,
  DEFAULT_GATEWAY_PORT,
  findProviderGatewayPidByPort,
  isProviderGatewayCommand,
} from '../src/stop-control.js';

const execFileAsync = promisify(execFile);

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessRunning(pid);
}

let pid = null;
let source = '';
let metadata = null;
try {
  metadata = await readPidFile(DEFAULT_PID_PATH);
} catch {
  // Missing or invalid pid file: fall back to the known local listener.
}

if (metadata) {
  const pidFromFile = metadata.pid;
  if (isProcessRunning(pidFromFile)) {
    const command = await commandForPid(execFileAsync, pidFromFile);
    if (!isProviderGatewayCommand(command)) {
      throw new Error(`Refusing to stop PID ${pidFromFile}; it is not Provider Gateway.`);
    }
    pid = pidFromFile;
    source = 'pid file';
  } else {
    await removePidFile(DEFAULT_PID_PATH);
    console.log('Provider Gateway pid file was stale; checking port listener.');
  }
}

if (!pid) {
  pid = await findProviderGatewayPidByPort({
    execFileAsync,
    port: DEFAULT_GATEWAY_PORT,
  });
  source = `port ${DEFAULT_GATEWAY_PORT}`;
}

if (!pid) {
  console.log('Provider Gateway is not running: no pid file and no gateway listener found.');
  process.exit(0);
}

process.kill(pid, 'SIGTERM');
const stopped = await waitForExit(pid);
if (!stopped) {
  throw new Error(`Provider Gateway PID ${pid} did not stop after SIGTERM.`);
}

await removePidFile(DEFAULT_PID_PATH);
console.log(`Provider Gateway stopped: PID ${pid} (${source}).`);
