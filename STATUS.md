# Project status log

_Last updated: 2026-10-16. The connector is integrated and verified end to end against the fake
HubSpot. The 2026-10-15 notes further down are history._

## Latest: connector integrated (2026-10-16)

**Gate results:**

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean |
| `npx vitest run` | 108 files, 2,466 tests |
| `npm run build` | Builds the app and `dist-server/` |
| `npm start` | Serves the builder, the SPA fallback and `/api/health` (200, even for plain monitor checks without the CSRF header) |
| `npx playwright test` | 27 passed: the 26 original tests plus "no backend", against the `build:static` builder |
| `npm run e2e:connect` | 9 passed: sign-in popup, live sample contact with associated deals, custom property in the picker, disconnect, deploy success / failed build / wrong key, static host / not-configured states |

**Fixes made during integration:**

- The muted Connect button (no connector, or sign-in not set up) is no longer `aria-disabled`. It
  opens the explanation.
- The top-bar breakpoints were moved up so the app and extension names stay readable next to
  Connect HubSpot / the account chip (1280–1920 px).
- The preview banner keeps "Preview" visible next to the live-data chip.
- The property suggestions are wider, and the label takes priority over the internal name.

**Still only a human can:**

- create the real HubSpot app;
- set `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` on Render;
- do the first real sign-in and deploy.

See "What only a human can do" below.

## Where things stand

### 1. The builder (complete and verified)

Last fully verified at commit `a57e518`, before the connector work started:

- `tsc -b` was clean.
- 1,995 unit tests passed.
- The production build succeeded.
- 26 Playwright end-to-end tests passed.

What it includes:

- **Components:** all 81 HubSpot UI components (`@hubspot/ui-extensions` 0.17 + `/crm`), each with HubSpot-style previews. Every prop is typechecked against the real package.
- **Editor:**
  - drag-and-drop canvas, layers tree and inspector with an expression and action builder
  - Data panel (state, data sources with "Generate UI", computed values, helper functions, mock data)
  - ⌘K command palette and keyboard shortcuts
  - autosave, and import/export of `.uiex.json` builder files
- **Templates and validation:** 14 starter cards, 15 blocks and a personal block library. Validation has one-click fixes.
- **Export:** generates a HubSpot developer project (platform 2026.03) as a `.zip`, with deploy instructions.
- **Review hardening:** an adversarial review found 86 issues (1 critical, 23 high). They were fixed, and the critical one (imported projects ran code automatically) now pauses imported code until the user trusts the file.
- **Hosted preview:** a static, private copy is at https://claude.ai/artifact/EYmLCKvc36GSN7pk1DqBMo. It has no backend, so it cannot connect to HubSpot.

### 2. "Sign in with HubSpot" connector (integrated; reviews pending)

**Goal:** non-technical admins connect their HubSpot portal without a terminal and preview cards with real CRM data. Pickers then use the real portal schema, and they can deploy to HubSpot with a personal access key (beta).

The contracts are committed:

- `src/connect/types.ts`: the API routes and data shapes.
- `server/core/types.ts`: server config, sessions and routing.
- `LiveDataAdapter` in `src/runtime/types.ts`.

| Module | Owner files | Status |
| --- | --- | --- |
| Server core: OAuth popup sign-in, encrypted cookie sessions, token refresh, read-only CRM routes, fetch proxy with SSRF guard, fake HubSpot portal | `server/core/**`, `server/fake-hubspot/handler.ts`, `seed.ts`, `search.ts` | **Done** |
| Hosting: Node production server, fake HubSpot dev server, `npm run dev:full`, Vercel / Cloudflare / Docker / Render adapters, `hubspot-app/` OAuth app project, `docs/HOSTING.md`, `public/secret.html` and `public/setup.html` | `server/node.ts`, `server/hosting.ts`, `api/`, `scripts/`, `docs/`, `hubspot-app/` … | **Done** |
| Deploy to HubSpot (beta): personal-access-key upload, stepped job, fake project endpoints, Deploy panel in the Export dialog | `server/core/deploy/**`, `server/core/routes/deploy.ts`, `server/fake-hubspot/projects.ts`, `src/panels/deploy/**` | **Done** |
| Client connection: Connect button, consent dialog, account menu, sample-record picker, Mock/Live toggle, live adapter, catalog hooks | `src/connect/**` + mount points in TopBar, AppShell, canvas toolbar | **Done** |
| Live data in the preview runtime | `src/runtime/**` | **Done** |
| Real-portal pickers in the Data panel and inspector | `src/panels/**`, `src/inspector/**` | **Done** |
| Integration and connector end-to-end tests (`e2e-connect/`, `npm run e2e:connect`) | whole repo | **Done** (2026-10-16) |
| Security and first-time-admin reviews, then fixes | whole repo | **Not started** |

**Current typecheck state:** 8 errors in the paused work.

- 7 are in the `tsconfig.server.json` project. Server code now pulls in `src/registry` (`.tsx` files), so that config needs `"jsx": "react-jsx"`, or the server should avoid importing UI modules.
- 1 is in `src/panels/deploy/DeployPanel.test.tsx`, which was being written.

The unit-test and e2e suites have not been re-run since the connector work began.

## How to resume

**Option A:** re-run the build workflow from its saved script. The two finished agents (server core, hosting) replay from cache; the unfinished ones re-run and continue from the files on disk.

```
Workflow({ scriptPath: "/root/.claude/projects/-home-user-Uiexbuilder/b04d6910-2b0e-5666-9061-79969b6019f7/workflows/scripts/hubspot-connector-wf_f350576c-7d9.js",
           resumeFromRunId: "wf_f350576c-7d9" })
```

The script path is local to this session. In a new session, ask Claude to "finish the HubSpot connector described in STATUS.md".

**Option B:** finish it manually, in this order:

1. Deploy UI.
2. Client connect (store, catalog, record picker, mount points).
3. Live data in the runtime.
4. Real-portal pickers.
5. Integration and connector e2e (`e2e:connect` against the fake HubSpot).
6. Security and UX review.
7. Full gate: `npx tsc -b`, `npx vitest run`, `npm run build`, `npx playwright test`.

## What only a human can do (once the connector is finished)

1. Create the HubSpot OAuth app. `hubspot-app/` is ready to upload, and `docs/HOSTING.md` explains the no-terminal path.
2. Host the builder and connector, e.g. with Render or Vercel one-click deploy. Set `APP_URL`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` and `SESSION_SECRET`.
3. Do the first real sign-in. Everything here is tested only against the fake HubSpot portal, because this sandbox cannot reach HubSpot.

## Update — hosting and next steps

### Hosting (Render)

- **Service:** `uiex-builder` at https://uiex-builder.onrender.com (free plan, Oregon). Dashboard: https://dashboard.render.com/web/srv-db8llg3bc2fs73frmrb0.
- **Deploys:** automatic from `claude/ui-extension-builder`. Render only switches the site live after a successful build.
- **Environment set:**
  - `NODE_VERSION=22`
  - `NODE_ENV=production`
  - `APP_URL=https://uiex-builder.onrender.com`
  - `SESSION_SECRET`, generated
- **Still blank:** `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`. Add them once the HubSpot sign-in app is registered. Its redirect URL is `https://uiex-builder.onrender.com/api/auth/callback`.

### Connector build

Resumed. The build phase is still running.

### Next: first-run experience for brand-new users (queued after the connector)

- **Welcome screen:** "Connect my HubSpot" (recommended) or "Try with sample data".
- **Guided setup:**
  1. Connect.
  2. Choose the record type, including the portal's custom objects.
  3. Pick a sample record and a starter card, which opens with real data.
- **Skippable 4-step tour** (add components, edit, preview, publish), replayable from Help.
- **Plain language:** "Publish to HubSpot" instead of "Deploy". Code, Problems and Console collapsed by default.
- **"Publish to HubSpot" wizard:** a direct link to the HubSpot personal access key page, a progress bar, an install-app link, and a link to the record page with a checklist for adding the card.
- **Fix-it buttons on errors** (missing scope → Reconnect) and a "Waking up…" screen for free-plan cold starts.
- **Usability test:** an agent role-plays a first-time admin end to end with screenshots; iterate until smooth.

## Log — paused again at the user's request (2026-10-15 ~23:50 UTC)

### Connector build workflow: stopped during the Integrate phase

| Phase | State |
| --- | --- |
| Build: server core, hosting, Publish to HubSpot (beta), client Connect UI, live data in the runtime, real-portal pickers | Done. All 6 agents finished and each module's own tests passed. |
| Integrate: wiring, connector end-to-end tests against the fake HubSpot, docs | Started, then stopped. No connector end-to-end suite exists yet (only the original `e2e/`). |
| Security + first-time-admin reviews, fixes, full gate | Not started |
| First-run experience (welcome, guided setup, tour, publish wizard) | Not started (plan above) |

**Code state** (everything committed and pushed; latest commit `5b8a5b4`):

- `npx tsc -b` reports 7 errors, all in `src/registry/index.ts` and all the same cause. The server tsconfig compiles UI modules (`.tsx`) but has no `jsx` option. **Fix:** add `"jsx": "react-jsx"` to `tsconfig.server.json`, or stop server code from importing UI modules.
- The unit tests, build and Playwright suites have **not** been run on the combined code since the build agents finished.

**Render:**

- Service `srv-db8llg3bc2fs73frmrb0`, https://uiex-builder.onrender.com. Nothing is live yet. Both builds so far failed on the typecheck errors above.
- **Pushes do NOT auto-deploy.** The service was created from a public repo URL, so Render receives no push webhooks. After pushing, trigger a deploy manually (Render MCP `trigger_deploy`, or "Manual Deploy" in the dashboard), or connect the repo through Render's GitHub app.

### Resume checklist

1. Fix the `tsconfig.server.json` jsx issue, then run `npx tsc -b` and `npx vitest run` and fix any failures.
2. Finish integration:
   - wire the modules together
   - add the connector end-to-end suite (`e2e:connect`) against the fake HubSpot: sign in, pick a record, live data, custom property picker, disconnect, publish (success and failure)
   - keep `npx playwright test` green
   - `npm run build` then `npm start` must serve the app and `/api/health`
3. Run the security review and first-time-admin review, then fix what they find.
4. Build the first-run experience and run an agent usability test.
5. Push, trigger the Render deploy, and verify https://uiex-builder.onrender.com and `/api/health`.
6. HubSpot sign-in app, with the user. Redirect URL: `https://uiex-builder.onrender.com/api/auth/callback`. Then set `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` on Render.

To restart the stopped workflow in this session (Build replays from cache; Integrate onward re-runs):

```
Workflow({ scriptPath: "/root/.claude/projects/-home-user-Uiexbuilder/b04d6910-2b0e-5666-9061-79969b6019f7/workflows/scripts/hubspot-connector-wf_f350576c-7d9.js",
           resumeFromRunId: "wf_f350576c-7d9" })
```
