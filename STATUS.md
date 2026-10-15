# Project status log

_Last updated: 2026-10-15 — work paused at the user's request._

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

### 2. "Sign in with HubSpot" connector (IN PROGRESS, paused)

**Goal:** non-technical admins connect their HubSpot portal without a terminal and preview cards with real CRM data. Pickers then use the real portal schema, and they can deploy to HubSpot with a personal access key (beta).

The contracts are committed:

- `src/connect/types.ts`: the API routes and data shapes.
- `server/core/types.ts`: server config, sessions and routing.
- `LiveDataAdapter` in `src/runtime/types.ts`.

| Module | Owner files | Status |
| --- | --- | --- |
| Server core: OAuth popup sign-in, encrypted cookie sessions, token refresh, read-only CRM routes, fetch proxy with SSRF guard, fake HubSpot portal | `server/core/**`, `server/fake-hubspot/handler.ts`, `seed.ts`, `search.ts` | **Done.** Its own tests pass. |
| Hosting: Node production server, fake HubSpot dev server, `npm run dev:full`, Vercel / Cloudflare / Docker / Render adapters, `hubspot-app/` OAuth app project, `docs/HOSTING.md`, `public/secret.html` and `public/setup.html` | `server/node.ts`, `server/hosting.ts`, `api/`, `scripts/`, `docs/`, `hubspot-app/` … | **Done.** Its own tests pass. |
| Deploy to HubSpot (beta): personal-access-key upload, stepped job, fake project endpoints, Deploy panel in the Export dialog | `server/core/deploy/**`, `server/core/routes/deploy.ts`, `server/fake-hubspot/projects.ts`, `src/panels/deploy/**` | **Partly done.** The server side is written; the UI panel and its tests were mid-way. |
| Client connection: Connect button, consent dialog, account menu, sample-record picker, Mock/Live toggle, live adapter, catalog hooks | `src/connect/**` + mount points in TopBar, AppShell, canvas toolbar | **Partly done.** `store.ts` and `catalog.ts` were being implemented. |
| Live data in the preview runtime | `src/runtime/**` | **Not started.** |
| Real-portal pickers in the Data panel and inspector | `src/panels/**`, `src/inspector/**` | **Not started.** |
| Integration, connector end-to-end tests, security and admin-UX reviews, fixes | whole repo | **Not started.** |

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
