import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_CONFIG_PATH = path.resolve('config/providers.local.json');
export const DEFAULT_EXAMPLE_CONFIG_PATH = path.resolve('config/providers.example.json');

const DEFAULT_FAILOVER_STATUS_CODES = [429, 500, 502, 503, 504];

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function normalizeProvider(rawProvider, index) {
  assertObject(rawProvider, `Provider at index ${index}`);

  const name = String(rawProvider.name || '').trim();
  const baseUrl = String(rawProvider.baseUrl || '').trim();
  const apiKey = String(rawProvider.apiKey || '');

  if (!name) {
    throw new Error(`Provider at index ${index} is missing name`);
  }
  if (!baseUrl) {
    throw new Error(`Provider ${name} is missing baseUrl`);
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`Provider ${name} has invalid baseUrl`);
  }
  if (!apiKey) {
    throw new Error(`Provider ${name} is missing apiKey`);
  }

  return {
    name,
    baseUrl,
    apiKey,
    enabled: rawProvider.enabled !== false,
    priority: Number.isFinite(Number(rawProvider.priority))
      ? Number(rawProvider.priority)
      : index + 1,
    notes: typeof rawProvider.notes === 'string' ? rawProvider.notes : '',
  };
}

export function normalizeConfig(rawConfig) {
  assertObject(rawConfig, 'Config');

  const providers = Array.isArray(rawConfig.providers)
    ? rawConfig.providers.map(normalizeProvider)
    : [];

  if (providers.length === 0) {
    throw new Error('Config must include at least one provider');
  }

  const seenNames = new Set();
  for (const provider of providers) {
    if (seenNames.has(provider.name)) {
      throw new Error(`Duplicate provider name: ${provider.name}`);
    }
    seenNames.add(provider.name);
  }

  const activeProvider = String(rawConfig.activeProvider || '').trim();
  const active = providers.find(
    (provider) => provider.name === activeProvider && provider.enabled,
  );
  if (!active) {
    throw new Error('Active provider must reference an enabled provider');
  }

  const server = rawConfig.server && typeof rawConfig.server === 'object'
    ? rawConfig.server
    : {};
  const host = String(server.host || '127.0.0.1').trim();
  const port = Number(server.port || 8787);
  if (!host) {
    throw new Error('Server host is required');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Server port must be an integer between 1 and 65535');
  }

  const requestTimeoutMs = Number(rawConfig.requestTimeoutMs || 120000);
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000) {
    throw new Error('requestTimeoutMs must be an integer >= 1000');
  }

  const logging = rawConfig.logging && typeof rawConfig.logging === 'object'
    ? rawConfig.logging
    : {};

  const failoverStatusCodes = Array.isArray(rawConfig.failoverStatusCodes)
    ? rawConfig.failoverStatusCodes.map(Number)
    : DEFAULT_FAILOVER_STATUS_CODES;
  for (const statusCode of failoverStatusCodes) {
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new Error('failoverStatusCodes must contain HTTP 4xx/5xx integers');
    }
  }

  return {
    server: { host, port },
    activeProvider,
    requestTimeoutMs,
    logging: {
      enabled: logging.enabled !== false,
    },
    failoverStatusCodes: [...new Set(failoverStatusCodes)],
    providers,
  };
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureLocalConfig({
  configPath = DEFAULT_CONFIG_PATH,
  examplePath = DEFAULT_EXAMPLE_CONFIG_PATH,
} = {}) {
  if (await exists(configPath)) {
    return;
  }

  await mkdir(path.dirname(configPath), { recursive: true });
  await copyFile(examplePath, configPath);
}

export async function readConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = await readFile(configPath, 'utf8');
  return normalizeConfig(JSON.parse(raw));
}

export async function writeConfig(configPath = DEFAULT_CONFIG_PATH, config) {
  const normalized = normalizeConfig(config);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}
