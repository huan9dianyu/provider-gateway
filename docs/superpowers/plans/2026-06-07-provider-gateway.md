# Provider Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent local Responses API provider gateway with UI-driven configuration and live provider switching.

**Architecture:** A single dependency-light Node.js service exposes `POST /v1/responses`, admin JSON APIs, and a static UI. Provider routing, config persistence, and HTTP server setup are split into focused modules.

**Tech Stack:** Node.js ESM, built-in `node:http`, `node:test`, `node:assert`, `fetch`, static HTML/CSS/JS.

---

## File Structure

- `package.json`: scripts for start and test.
- `.gitignore`: excludes local config and transient files.
- `config/providers.example.json`: safe example config.
- `src/config.js`: read, validate, normalize, and write config.
- `src/router.js`: provider ordering, target URL normalization, failover proxy logic.
- `src/server.js`: local HTTP routes and static admin page.
- `src/index.js`: CLI entrypoint.
- `public/admin.html`: local configuration UI.
- `test/config.test.js`: config validation behavior.
- `test/router.test.js`: Responses proxy and failover behavior.
- `test/server.test.js`: admin API hot-reload behavior.

### Task 1: Project Skeleton and Config Tests

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `config/providers.example.json`
- Create: `test/config.test.js`
- Create: `src/config.js`

- [ ] **Step 1: Write failing config tests**

Create `test/config.test.js` with tests for provider ordering, active provider validation, and invalid duplicate names.

- [ ] **Step 2: Run config tests to verify red**

Run: `npm test -- test/config.test.js`

Expected: fail because `src/config.js` does not exist.

- [ ] **Step 3: Implement minimal config module**

Create `src/config.js` with `normalizeConfig`, `readConfig`, and `writeConfig`.

- [ ] **Step 4: Run config tests to verify green**

Run: `npm test -- test/config.test.js`

Expected: all config tests pass.

### Task 2: Router Failover Tests and Implementation

**Files:**
- Create: `test/router.test.js`
- Create: `src/router.js`

- [ ] **Step 1: Write failing router tests**

Cover URL normalization, primary success, 500 failover to backup, and non-failover 400 behavior.

- [ ] **Step 2: Run router tests to verify red**

Run: `npm test -- test/router.test.js`

Expected: fail because `src/router.js` does not exist.

- [ ] **Step 3: Implement router module**

Create `buildProviderUrl`, `orderedProviders`, and `proxyResponsesRequest`.

- [ ] **Step 4: Run router tests to verify green**

Run: `npm test -- test/router.test.js`

Expected: all router tests pass.

### Task 3: Server API Tests and Implementation

**Files:**
- Create: `test/server.test.js`
- Create: `src/server.js`
- Create: `src/index.js`

- [ ] **Step 1: Write failing server tests**

Cover `GET /api/config`, `PUT /api/config`, and `POST /api/active-provider`.

- [ ] **Step 2: Run server tests to verify red**

Run: `npm test -- test/server.test.js`

Expected: fail because `src/server.js` does not exist.

- [ ] **Step 3: Implement server module and entrypoint**

Create HTTP routes, JSON helpers, static file serving, and startup logic.

- [ ] **Step 4: Run server tests to verify green**

Run: `npm test -- test/server.test.js`

Expected: all server tests pass.

### Task 4: Admin UI and End-to-End Verification

**Files:**
- Create: `public/admin.html`
- Modify: `README.md`

- [ ] **Step 1: Create admin UI**

Build a single HTML page for provider table editing, save, active switching, and status refresh.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Start the service**

Run: `npm start`

Expected: service listens on `http://127.0.0.1:8787`.

- [ ] **Step 4: Verify local endpoints**

Run: `curl -sS http://127.0.0.1:8787/api/status`

Expected: JSON status response.

## Self-Review

- Spec coverage: the tasks cover Responses-only proxying, config file storage, local UI, manual switching, automatic failover, hot reload, and docs.
- Placeholder scan: no implementation behavior is deferred.
- Type consistency: config shape is shared across tests, router, and server.
