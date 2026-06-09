import { rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_PID_PATH = path.resolve('.provider-gateway.pid');

export async function writePidFile(
  pidPath = DEFAULT_PID_PATH,
  { pid = process.pid, cwd = process.cwd(), startedAt = new Date().toISOString() } = {},
) {
  await writeFile(
    pidPath,
    `${JSON.stringify({ pid, cwd, startedAt }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function readPidFile(pidPath = DEFAULT_PID_PATH) {
  const metadata = JSON.parse(await readFile(pidPath, 'utf8'));
  const pid = Number(metadata.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Invalid provider gateway pid file');
  }
  return {
    pid,
    cwd: String(metadata.cwd || ''),
    startedAt: String(metadata.startedAt || ''),
  };
}

export async function removePidFile(pidPath = DEFAULT_PID_PATH) {
  await rm(pidPath, { force: true });
}
