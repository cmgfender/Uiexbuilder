# UI Extension Builder for HubSpot

A visual, drag-and-drop builder for **HubSpot UI extensions**: app cards (record tab, sidebar,
preview panel, help desk), app settings pages and app home pages. Compose extensions from HubSpot's
real component library, wire up state, CRM data and actions without code, preview them with mock
data, then export a **ready-to-deploy HubSpot developer project**.

> Why a web app and not a HubSpot app? UI extensions run in a sandbox that can only render
> HubSpot's components (no DOM, no drag & drop, no custom CSS) and cannot produce or deploy project
> files. A standalone web app can render faithful previews, offer a real editing surface, and
> generate the exact project structure `hs project upload` expects. See [SCOPE.md](SCOPE.md).

## Features

- **Every HubSpot UI component** (`@hubspot/ui-extensions` 0.17 + `/crm`): layout, text, buttons,
  inputs & forms, tables, statistics, charts, modals & panels, tooltips, CRM data and CRM action
  components — with location-aware availability and structural rules.
- **Drag & drop canvas** rendered to look like HubSpot, sized per extension location, with
  selection outlines, insertion indicators, an overlay storyboard for modals/panels, inline text
  editing, context menus, layers tree, undo/redo, copy/paste and keyboard shortcuts.
- **Inspector** generated from the component registry: typed editors for every prop, defaults,
  docs links, `{{ expression }}` templates and full expression mode.
- **Logic without code**: state variables, two-way input binding, conditional rendering, repeat over
  arrays, and event actions (set state, alerts, refresh properties, iframe modal, close overlay,
  copy, refetch data, `hubspot.fetch`, app functions, logging, if/else, custom code).
- **Data sources**: `useCrmProperties`, `useAssociations`, `useCrmSearch`, `hubspot.fetch`
  endpoints and app functions (`hubspot.serverless`), each with editable mock data.
- **Interactive preview** that simulates HubSpot: alerts, overlays, iframe modal, state, data.
- **Code view & export**: live generated TSX and project files; export a `.zip` project
  (platform `2026.03`) with `hsproject.json`, `app-hsmeta.json`, card/settings/page configs,
  app functions, README and a re-importable `.uiex.json` builder document.
- **Templates**: starter cards and drop-in blocks; **validation** with a problems panel.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build the static app into `dist/` |
| `npm test` | Unit/integration tests (Vitest), incl. type-checking generated cards against `@hubspot/ui-extensions` |
| `npm run e2e` | End-to-end tests (Playwright) |

## Deploying what you build

1. In the builder click **Export** → **Download project (.zip)** and unzip it.
2. Install the HubSpot CLI and authenticate: `npm install -g @hubspot/cli` then `hs account auth`.
3. Install the extension dependencies: `cd src/app/cards && npm install` (repeat for
   `src/app/settings` / `src/app/pages` if present).
4. From the project root run `hs project upload` (or `hs project dev` for local development).
5. In HubSpot, open a record → **Customize** the record view → add your card from the
   **Card library** (filter by *App*).

The exported README lists the scopes and permitted URLs the project needs.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for module contracts.

```
src/
  model/      document model, tree ops, placement rules, store (undo/redo), persistence, validation
  registry/   HubSpot component definitions (props, events, slots, previews)
  preview/    HubSpot-like preview styles
  runtime/    expression engine + interactive preview runtime
  codegen/    TSX + project generation, zip export
  canvas/     design surface, selection, drag & drop
  inspector/  property / events / advanced editors
  panels/     data, app settings, functions, export, projects
  templates/  starter extensions and blocks
  shell/      app layout, palette, layers, code/problems/console
  ui/         builder UI kit
```
