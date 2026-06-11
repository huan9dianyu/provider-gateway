import { execFile } from 'node:child_process';
import { platform } from 'node:os';

const DEFAULT_COMMAND = '/usr/bin/osascript';
const MAX_MESSAGE_LENGTH = 4000;

function truncate(value, maxLength = MAX_MESSAGE_LENGTH) {
  const text = value === undefined || value === null ? '-' : String(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function appleScriptString(value) {
  return JSON.stringify(truncate(value));
}

export function createMacOSFailoverNotifier({
  platformName = platform(),
  command = DEFAULT_COMMAND,
  execFileImpl = execFile,
} = {}) {
  return function notifyMacOSFailover({
    type = 'failover',
    fromProvider,
    toProvider,
    status,
    reason,
  } = {}) {
    if (platformName !== 'darwin') {
      return false;
    }

    const statusText = status ? `，状态码 ${status}` : '';
    const reasonText = reason ? `，原因：${truncate(reason)}` : '';
    const message = `${truncate(fromProvider)} -> ${truncate(toProvider)}${statusText}${reasonText}`;
    const subtitle = type === 'recovered'
      ? 'Provider 已恢复主路由'
      : 'Provider 故障切换';
    const script = [
      'display notification',
      appleScriptString(message),
      'with title',
      appleScriptString('Provider Gateway'),
      'subtitle',
      appleScriptString(subtitle),
    ].join(' ');

    execFileImpl(
      command,
      ['-e', script],
      { shell: false, timeout: 5000 },
      () => {},
    );
    return true;
  };
}
