# Provider Gateway Admin UI Refresh Design

## Goal

Improve the local admin settings page so it feels like a polished operations console while keeping the current single-file HTML implementation and existing API behavior.

## Chosen Direction

Use the "ops dashboard" direction selected by the user:

- light, restrained control-console visual style.
- clear top-level status summary.
- service settings grouped separately from provider management.
- provider editing remains direct and table-based for efficiency.

## Scope

In scope:

- Restyle `public/admin.html`.
- Reorganize the visible page structure.
- Preserve all existing controls and API calls.
- Improve desktop and mobile layout.
- Add clearer status chips, section headers, and primary action hierarchy.

Out of scope:

- Backend API changes.
- New frontend dependencies.
- Authentication, masking, or storage behavior changes.
- Changing provider config semantics.

## UI Structure

The refreshed page has four main regions:

1. Header
   - product name and short description.
   - endpoint display.
   - primary actions: refresh, save.

2. Status summary
   - configured active provider.
   - runtime provider.
   - enabled provider count.
   - retry time.

3. Settings grid
   - service settings panel: host, port, timeout, failover codes.
   - active provider panel: provider select, immediate switch, status message.

4. Provider management
   - toolbar with add provider.
   - improved editable table.
   - visual enabled switch.
   - better spacing for API key and notes textareas.

## Interaction Behavior

No behavior changes are required. Existing functions continue to:

- load config from `GET /api/config`.
- save config through `PUT /api/config`.
- switch active provider through `POST /api/active-provider`.
- refresh runtime status through `GET /api/status`.

The JavaScript may add small derived UI values, such as enabled provider count, but should not change payload shape.

## Responsive Behavior

Desktop uses a dashboard layout with constrained content width and grouped panels. Mobile stacks panels vertically and converts provider rows into readable blocks using existing `data-label` attributes.

## Verification

Run:

- `npm test`

Then start the local service and visually inspect `/admin` at desktop and mobile widths. The page should render without overlap, clipped text, or broken controls.
