export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childExitMessage(exitStatus, recentLog) {
  const { code, signal } = exitStatus;
  const reason = signal ? `signal ${signal}` : `exit code ${code}`;
  const logSuffix = recentLog ? `\n\nRecent log output:\n${recentLog}` : '';
  return `Provider Gateway exited before creating a pid file (${reason}).${logSuffix}`;
}

export async function waitForStartedPid({
  child,
  isProcessRunning,
  readPidFile,
  readRecentLog = async () => '',
  timeoutMs = 5000,
  pollMs = 100,
}) {
  let childExit = null;
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childExit) {
      throw new Error(childExitMessage(childExit, await readRecentLog()));
    }

    try {
      const metadata = await readPidFile();
      if (isProcessRunning(metadata.pid)) {
        return metadata.pid;
      }
    } catch {
      await wait(pollMs);
    }
  }

  if (childExit) {
    throw new Error(childExitMessage(childExit, await readRecentLog()));
  }

  const recentLog = await readRecentLog();
  const logSuffix = recentLog ? ` Recent log output:\n${recentLog}` : '';
  throw new Error(`Provider Gateway did not create a pid file within ${timeoutMs / 1000} seconds.${logSuffix}`);
}
