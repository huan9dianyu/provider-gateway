import { DEFAULT_CONFIG_PATH, ensureLocalConfig } from './config.js';
import {
  DEFAULT_PID_PATH,
  removePidFile,
  writePidFile,
} from './process-control.js';
import { createMacOSFailoverNotifier } from './macos-notifier.js';
import { createGatewayServer } from './server.js';

const configPath = process.env.PROVIDER_GATEWAY_CONFIG || DEFAULT_CONFIG_PATH;

await ensureLocalConfig({ configPath });

const app = await createGatewayServer({
  configPath,
  failoverNotifier: createMacOSFailoverNotifier(),
  inspectRequests: process.env.PROVIDER_GATEWAY_INSPECT_REQUESTS === '1',
});
await app.listen();
await writePidFile(DEFAULT_PID_PATH);

console.log(`Provider gateway listening on ${app.url}`);
console.log(`Admin UI: ${app.url}/admin`);
console.log(`Responses endpoint: ${app.url}/v1/responses`);

process.on('SIGINT', async () => {
  await app.close({ force: true });
  await removePidFile(DEFAULT_PID_PATH);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await app.close({ force: true });
  await removePidFile(DEFAULT_PID_PATH);
  process.exit(0);
});
