# Provider Gateway Design

## Goal

Build an independent local gateway for Codex Responses API traffic. Codex points to one local endpoint, while the gateway routes `POST /v1/responses` to one of several configured providers.

## Scope

- In scope: `POST /v1/responses`, provider configuration UI, manual active-provider switching, automatic failover, hot-reloaded runtime configuration.
- Out of scope: chat-completions compatibility, Codex plugin integration, modifying Codex config files, remote hosting, multi-user authentication.

## Architecture

The service is a dependency-light Node.js application using only built-in modules. It exposes:

- `POST /v1/responses`: OpenAI Responses-compatible proxy endpoint.
- `GET /admin`: static local UI.
- `GET /api/config`: return current config with API keys included for local editing.
- `PUT /api/config`: validate, persist, and hot-apply config.
- `POST /api/active-provider`: switch the active provider immediately.
- `GET /api/status`: show active provider and recent provider health.

The service listens on `127.0.0.1` by default so API keys in the UI are not exposed on the LAN.

## Configuration

Runtime configuration lives in `config/providers.local.json`. A placeholder example lives in `config/providers.example.json`.

Config includes:

- server host and port.
- request timeout.
- failover status codes.
- active provider name.
- ordered providers with name, base URL, API key, enabled flag, priority, and optional notes.

API keys are stored in the local config file by user request. The project `.gitignore` excludes `config/providers.local.json`.

## Routing

For `POST /v1/responses`, the gateway tries the active provider first. If it fails with a network error, timeout, HTTP 429, or configured 5xx status, the gateway tries enabled backup providers by priority.

If a provider succeeds, the gateway streams the successful response body and status back to the client. If every provider fails, the gateway returns a JSON error containing the attempted provider names and failure reasons.

## UI

The UI is a single local HTML page with JavaScript. It allows adding, editing, deleting, enabling, disabling, reordering by priority, setting active provider, editing server settings, saving config, and seeing current status.

Saving config calls `PUT /api/config`; the service writes the file and replaces the in-memory config immediately.

## Testing

Node's built-in test runner covers:

- config validation and ordering.
- target URL normalization for `/v1/responses`.
- proxy failover from primary to backup.
- manual active-provider switching.
- config persistence and hot reload.
