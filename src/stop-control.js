export const DEFAULT_GATEWAY_PORT = 8787;

export function isProviderGatewayCommand(command) {
  return /\bnode\b/.test(command) && command.includes('src/index.js');
}

export async function commandForPid(execFileAsync, pid) {
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
  return stdout.trim();
}

export async function pidsListeningOnPort(execFileAsync, port = DEFAULT_GATEWAY_PORT) {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ]);
    return stdout
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

export async function findProviderGatewayPidByPort({
  execFileAsync,
  port = DEFAULT_GATEWAY_PORT,
}) {
  const pids = await pidsListeningOnPort(execFileAsync, port);
  for (const pid of pids) {
    try {
      const command = await commandForPid(execFileAsync, pid);
      if (isProviderGatewayCommand(command)) {
        return pid;
      }
    } catch {
      // Process may have exited between lsof and ps.
    }
  }
  return null;
}
