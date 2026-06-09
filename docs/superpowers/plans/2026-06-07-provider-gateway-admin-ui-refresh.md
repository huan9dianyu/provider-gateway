# Provider Gateway Admin UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the local Provider Gateway admin page into a polished operations-console settings UI.

**Architecture:** Keep the existing static single-page admin implementation in `public/admin.html`. Rework markup and CSS for clearer status summary, grouped settings, and provider management while preserving the existing API calls and config payload shape.

**Tech Stack:** Plain HTML, CSS, vanilla JavaScript, Node.js built-in test runner.

---

## File Structure

- Modify `public/admin.html`: replace the current basic card/table styling with a dashboard layout and small derived UI values.
- No backend files change.
- No new runtime dependencies.

### Task 1: Refresh Admin Markup And Styling

**Files:**
- Modify: `public/admin.html`

- [ ] **Step 1: Update CSS design tokens and layout**

Replace the existing page CSS with a light operations-console theme:

```css
:root {
  color-scheme: light;
  --bg: #f3f6fa;
  --panel: #ffffff;
  --panel-soft: #f8fafc;
  --line: #dbe3ee;
  --line-strong: #c7d2e0;
  --text: #111827;
  --muted: #64748b;
  --accent: #0f766e;
  --accent-dark: #115e59;
  --danger: #b42318;
  --warning: #b45309;
  --focus: #2563eb;
  --shadow: 0 14px 35px rgba(15, 23, 42, 0.08);
}
```

- [ ] **Step 2: Rework visible page structure**

Keep all existing element IDs used by JavaScript and reorganize them into:

```html
<header class="shell-header">...</header>
<main class="wrap">
  <section class="hero-panel">...</section>
  <section class="summary-grid">...</section>
  <section class="settings-grid">...</section>
  <section class="providers-panel">...</section>
</main>
```

- [ ] **Step 3: Preserve JavaScript behavior**

Keep the existing API functions and event listeners. Add only derived display helpers for enabled provider count and table empty state.

- [ ] **Step 4: Improve responsive behavior**

Use CSS media queries so settings panels stack on narrow screens and provider rows remain readable through existing `data-label` attributes.

### Task 2: Verify Behavior And Rendering

**Files:**
- Verify: `public/admin.html`

- [ ] **Step 1: Run automated tests**

Run:

```bash
npm test
```

Expected: all Node tests pass.

- [ ] **Step 2: Start local service**

Run:

```bash
npm start
```

Expected: service listens on `http://127.0.0.1:8787`.

- [ ] **Step 3: Inspect admin UI**

Open:

```text
http://127.0.0.1:8787/admin
```

Expected: no overlapping controls, status summary renders, provider rows are editable, and action buttons remain usable.

## Self-Review

- Spec coverage: all selected ops-dashboard design requirements map to Task 1.
- Placeholder scan: no deferred behavior is required.
- Type consistency: existing IDs and config field names are preserved.
