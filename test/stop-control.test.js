import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findProviderGatewayPidByPort } from '../src/stop-control.js';

test('findProviderGatewayPidByPort returns gateway process listening on the default port', async () => {
  const commands = new Map([
    [111, '/usr/bin/python other-service.py'],
    [222, '/Users/example/.hermes/node/bin/node src/index.js'],
  ]);
  const calls = [];

  const pid = await findProviderGatewayPidByPort({
    execFileAsync: async (command, args) => {
      calls.push([command, args]);
      if (command === 'lsof') {
        return { stdout: '111\n222\n' };
      }
      if (command === 'ps') {
        return { stdout: commands.get(Number(args[1])) || '' };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    port: 8787,
  });

  assert.equal(pid, 222);
  assert.deepEqual(calls[0], ['lsof', ['-nP', '-iTCP:8787', '-sTCP:LISTEN', '-t']]);
});
