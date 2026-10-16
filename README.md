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
- **Rules** on any simple setting or text (the filter icon next to **fx**): pick the value by
  comparing something, e.g. a progress bar green at 80% or more, yellow from 40%, red below; a tag
  color by deal stage; a status line by a CRM property. "Based on" lists the component's own values
  plus everything in scope (state, computed values, record properties, data, repeat item, context)
  and shows the result right now. Rules are saved as plain expressions, so the exported code is
  ordinary TSX.
- **Logic without code**: state variables, two-way input binding, conditional rendering, repeat over
  arrays, and event actions (set state, alerts, refresh properties, iframe modal, close overlay,
  copy, refetch data, `hubspot.fetch`, app functions, logging, if/else, custom code).
- **Data sources**: `useCrmProperties`, `useAssociations`, `useCrmSearch`, `hubspot.fetch`
  endpoints and app functions (`hubspot.serverless`), each with editable mock data.
- **Interactive preview** that simulates HubSpot: alerts, overlays, iframe modal, state, data —
  including the first render while data is still loading, and simulated loading / empty / error
  states per data source (Data › Mock data › Simulate).
- **Code view & export**: live generated TSX and project files; export a `.zip` project
  (platform `2026.03`) with `hsproject.json`, `app-hsmeta.json`, card/settings/page configs,
  app functions, README and a re-importable `.uiex.json` builder document.
- **Templates**: starter cards and drop-in blocks; **validation** with a problems panel and
  one-click fixes (missing scopes and permitted URLs, misspelt names, CRM property typos, …),
  including checks for things that only break once deployed (reading data before it has loaded,
  `context.crm` outside cards, app functions the app type can't upload).
- **Safe by default**: a `.uiex.json` someone else made opens with its code paused (helpers,
  calls, custom code) until you choose **Trust and run code**; runaway loops are stopped; a
  document that crashes the editor opens a recovery screen instead of a blank page. Projects
  autosave in this browser, and a second tab never silently overwrites the first.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev:full   # same, plus a fake HubSpot with demo data to try "Connect HubSpot" offline
```

The development server only listens on this computer; add `-- --host` (e.g. `npm run dev -- --host`)
to open it to other devices on your network.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev:vite` | The builder alone (no connector: Connect HubSpot shows as unavailable) |
| `npm run build` | Type-check and build the app into `dist/` and the server into `dist-server/` |
| `npm start` | Production server: the builder + the HubSpot connector on `$PORT` (default 3000) |
| `npm run build:static` | The builder for plain static hosting (no connector, never calls `/api`) |
| `npm run start:demo` | Production build with a fake HubSpot on http://localhost:4174 (demos; run `npm run build` first) |
| `npm run secret` | Print a random `SESSION_SECRET` |
| `npm test` | Unit/integration tests (Vitest), incl. the connector against a fake HubSpot and type-checking generated cards against `@hubspot/ui-extensions` |
| `npm run e2e` | End-to-end tests (Playwright) of the static builder |
| `npm run e2e:connect` | End-to-end tests of the first-run setup, Connect HubSpot, live data and Publish to HubSpot against the fake HubSpot (`CONNECT_SCREENSHOTS=<dir>` saves screenshots) |

## Deploying what you build

1. In the builder click **Publish** → **Download** tab → **Download project (.zip)** and unzip it.
2. Install the HubSpot CLI and authenticate: `npm install -g @hubspot/cli` then `hs account auth`.
3. Install the extension dependencies: `cd src/app/cards && npm install` (repeat for
   `src/app/settings` / `src/app/pages` if present).
4. If your app functions use secrets, add each one first: `hs secret add <NAME>`.
5. From the project root run `hs project upload` (or `hs project dev` for local development).
6. Install the app in your account: `hs project install-app` for a private app with static auth
   (OAuth apps use the install link from the app's **Distribution** page).
7. In HubSpot, open a record → **Customize** the record view → add your card from the
   **Card library** (filter by *App*).

The exported README repeats these steps for your project (its secrets, functions, endpoints and
where each card goes) and lists the scopes and permitted URLs it needs.

## Connect to HubSpot

When the builder is hosted with its small **connector** (any option under [Hosting](#hosting)),
admins can sign in with HubSpot - no terminal, no install. On a first visit a **welcome screen**
offers **Connect my HubSpot** or **Try it with sample data**, then a 3-step guided setup (connect →
where the card appears → a real sample record and a starter) opens the editor with real data and a
short tour (replay it, or the welcome, from **Help**). The same, step by step:

1. Click **Connect HubSpot** (top right). The builder first explains what it can and cannot do;
   click **Continue to HubSpot**, approve in the HubSpot window, and the top bar shows your
   account (for example `acmedemo.com · 12345678`). Click it for the account menu
   (permissions, **Switch account**, **Disconnect**).
2. In the canvas toolbar choose **Live data** and **Pick a sample record**: the preview shows its
   real properties, associations, CRM search results and record context. **Mock data** switches
   back any time.
3. Property, object-type and pipeline pickers list your account's real schema: custom properties,
   labels and dropdown options.
4. **Publish** (top right) → **Publish to HubSpot** (beta) uploads the generated project with a
   personal access key you create in HubSpot (the wizard links straight to HubSpot's key page for
   your account; tick **Developer projects**) - instead of the CLI steps above - then lists what
   to do in HubSpot (install the app, add the card to the record page, open a record) with direct
   links. Publishing needs you to be connected to the same HubSpot account, and asks for the key
   each time (it is never stored).

Access is **read-only**. HubSpot's tokens never reach the browser: the connector keeps them in an
encrypted, `HttpOnly` cookie (there is no database) and refreshes them automatically. Set
`ALLOWED_PORTALS` to your HubSpot account number(s) so only your accounts can connect and deploy.
A project someone else made opens with its code paused; while you are connected, trusting it
says plainly that its code can read your HubSpot data. To remove
access, click **Disconnect**, or uninstall the app in HubSpot (**Settings → Integrations →
Connected apps**). Without a connector (e.g. plain static hosting or `npm run dev:vite`) the builder
works exactly as before, with mock data, and **Connect HubSpot** explains that it is available on
the hosted version. For plain static hosting build with `npm run build:static`, so the builder
does not even try to reach `/api`.

## Hosting

Put the builder online with sign-in in a few clicks - step-by-step guide for non-developers:
**[docs/HOSTING.md](docs/HOSTING.md)**.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/cmgfender/Uiexbuilder)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcmgfender%2FUiexbuilder&project-name=uiex-builder&repository-name=uiex-builder&env=APP_URL,HUBSPOT_CLIENT_ID,HUBSPOT_CLIENT_SECRET,SESSION_SECRET&envDescription=For%20SESSION_SECRET%20type%2048%20random%20letters%20and%20numbers%20%28a%20password%20manager%27s%20generator%20works%29%20-%20Deploy%20to%20HubSpot%20needs%20it.%20Type%20%22later%22%20in%20the%20other%20three%20boxes%20if%20you%20do%20not%20have%20the%20values%20yet%3B%20the%20builder%20works%20without%20them%2C%20only%20Connect%20HubSpot%20waits.&envLink=https%3A%2F%2Fgithub.com%2Fcmgfender%2FUiexbuilder%2Fblob%2FHEAD%2Fdocs%2FHOSTING.md%23step-3---add-the-hubspot-settings-to-your-host)

In short:

1. Deploy (Render, Vercel, Cloudflare Workers via `wrangler.toml`, Docker via `Dockerfile`, or any
   Node.js host with `npm run build && npm start`).
2. Create the HubSpot app that people approve when they connect - from the builder itself
   (`/setup.html` → **Download the app file** → **Project › Import .uiex.json…** → **Publish** →
   **Publish to HubSpot**; needs `SESSION_SECRET` set first) or with the HubSpot CLI from
   [`hubspot-app/`](hubspot-app). Then sign HubSpot's Acceptable Use Policy for the app
   (**Distribution → Begin publishing**).
3. Set `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` and `SESSION_SECRET` (plus `APP_URL` on
   Docker or with your own domain, and optionally `ALLOWED_PORTALS`) - see
   [`.env.example`](.env.example).
4. Open `/setup.html` on your builder to check that sign-in is ready, then share the address.

| Platform | Files |
| --- | --- |
| Render | `render.yaml` (Blueprint, health check `/api/health`) |
| Vercel | `vercel.json`, `api/[...path].ts` (Edge Function) |
| Cloudflare Workers | `wrangler.toml`, `server/cloudflare.ts` |
| Docker | `Dockerfile`, `.dockerignore` |
| Node.js | `server/node.ts` → `dist-server/node.mjs` |

All of them run the same connector core (`server/core`, standard Web `Request`/`Response`).

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for module contracts.

```
server/
  core/       HubSpot connector: OAuth sign-in, encrypted cookie sessions, read-only CRM API
  node.ts     production Node server (static files + /api); cloudflare.ts: Workers adapter
  fake-hubspot/  in-memory HubSpot for tests and `npm run dev:full`
api/          Vercel adapter
hubspot-app/  the HubSpot app behind "Connect HubSpot" (developer project)
docs/         HOSTING.md: put the builder online with sign-in (for non-developers)
e2e/          end-to-end tests of the static builder; e2e-connect/: Connect HubSpot against the fake HubSpot
src/
  model/      document model, tree ops, placement rules, store (undo/redo), persistence, validation
  registry/   HubSpot component definitions (props, events, slots, previews)
  preview/    HubSpot-like preview styles
  runtime/    expression engine + interactive preview runtime
  codegen/    TSX + project generation, zip export
  connect/    HubSpot connection client: sign-in, live preview data, portal schema for pickers
  canvas/     design surface, selection, drag & drop
  inspector/  property / events / advanced editors
  panels/     data, app settings, functions, export, projects
  templates/  starter extensions and blocks
  shell/      app layout, palette, layers, code/problems/console
  ui/         builder UI kit
```
