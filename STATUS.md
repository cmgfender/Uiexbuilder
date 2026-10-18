# Project status log

## 2026-10-18 (later) — independent review: 7 findings checked, all real, all fixed

An independent reviewer reported seven findings. Each was reproduced first (their scratch tests
failed as described: `count === ""` exported and failed the type-check with no validation error;
pasting a Tab's settings gave two tabs `tabId: "overview"`; 3,000 sign-in starts left 3,000
followed sign-ins). None was refuted. What changed:

- **Fake “browser errors” on the status page (R1, medium).** `POST /api/diagnostics/report` now
  needs the builder's own `Origin` (browsers always send it; a plain script without one gets 403
  and leaves no row). Links to anything but the builder's own address become `[link]` in messages
  and stacks; page paths that aren't plain paths (`/javascript:…`) are dropped. Browser reports
  live in their own buffer of 100, so they can't push sign-ins and publishes out; after 5 distinct
  reports per visitor (30 from everyone) in an hour, the rest are only counted in one “More browser
  error reports” row. On the page they are marked **Reported by a browser · not verified**, say
  “the report says…”, warn not to follow links or advice in the message, and never rank above what
  the server saw itself. “What is recorded” says browser reports keep their message.
- **Half-finished checks broke the export (R2, medium).** The condition builder saves a check only
  once its value fits (an emptied number box shows “Enter a number.” and is left out until fixed);
  “is” on a true / false value starts at true; a new subject re-reads the typed value. As a
  backstop, a new validation **error** `condition-type` flags any expression — Show when, If, Rules,
  props, templates, action values — that compares a typed value with a fixed value of another type
  (or a variable that starts empty with more / less than, which TypeScript also refuses). It is
  pinned by two type-check matrices (17 subjects for conditions and 14 for Rules, each × 4
  comparisons × 5 fixed values) that require validation and the strict compiler to agree exactly. On the way:
  text thresholds are now written `String(x ?? "") > "…"`, so they compile for values that may be
  empty; the Rules editor shows the same problem line under a threshold that doesn't fit.
- **Copy / paste settings and multi-edit copied a Tab's id (R3, medium).** Components can declare
  identity props (`ComponentDef.identityProps`: Tab `tabId`, statistics item `id`); they are never
  copied, pasted or offered in multi-edit.
- **Moving through “What did HubSpot show?” sent one answer per choice (R4, low).** The help sends
  the answer the person settles on (after 2 s without a change, or at once when they act on the fix
  or close the help); a changed answer is always sent (the old 10 s per-answer throttle could drop
  the final one). The server replaces the answer on the visitor's latest “never came back” row when
  they change their mind within 5 minutes; the browser's own “window closed” never overrides it.
- **The canvas trash button deleted only one of several selected components (R5, low).** It now
  says **Delete N selected** and deletes them all in one undo step, like the Delete key.
- **Unbounded sign-ins in progress (R6, low).** At most 500 are followed (the oldest quietly stops
  being followed); a sign-in whose row is gone is only counted when it times out, and one visitor's
  unanswered sign-ins close together become one row with a count — a burst of starts can no longer
  flood the page ten minutes later.
- **Screen readers heard “Updated …” every 30 s (R7, low).** That line is no longer a live region;
  a hidden one announces a refresh someone asked for and new problems, and the timeline count is
  announced only when the filters change.

**Gate results** (after the last change)

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean |
| `npx vitest run` | 137 files, 2,886 tests, all passing (22 new) |
| `npm run build` | Builds the app and `dist-server/` |
| `npx playwright test` | 38 passed, twice (new: toolbar trash deletes every selected component) |
| `npm run e2e:connect` | 20 passed, twice (`status.spec.ts` now also checks that a scripted report is refused and a browser one is shown “not verified” without outside links) |

Screenshots of the status page with a reported error (light and dark):
`/tmp/claude-0/-home-user-Uiexbuilder/b04d6910-2b0e-5666-9061-79969b6019f7/scratchpad/improve/fix/shots/`.
`git diff` was checked for whole-file reformatting (none) and token-shaped literals (none).

**Still open (honestly)**

- The `Origin` check only stops the laziest scripts: anyone can send that header. Reports stay
  untrusted by design; the limits above bound how much a sender can show, not whether it is true.
  The per-visitor limits key on an anonymous id of the IP address, so many addresses still get
  more rows (at most 30 an hour, in their own buffer).
- `condition-type` knows the types the builder declares (variables, record properties, list sizes,
  context values, data loading / error flags); comparisons on computed values, repeat items or
  handler values are not checked (they are untyped in the exported card, so they compile).
- A check whose value doesn't fit is left out of the saved condition while it is being fixed, so the
  component shows without that check meanwhile (like a check whose subject is still being chosen).
- Everything listed under “Still open” in the entry below still applies.

## 2026-10-18 — easier editor, HubSpot saying no, a status page, and power features without code

Four areas were improved in parallel and then integrated; the full gate is green (see the table).
`git diff` was checked for whole-file reformatting (none) and for token-shaped literals (none: the
`pat-…` test values are built at runtime).

**What changed for a first-time admin**

- **Editing is easier to find.** Inserting a block selects its main part (*Progress tracker* →
  the progress bar, with Color and its green / yellow / red Rules right there). A layout box lists
  what is **Inside this layout box**, each child one click away with a hint (“Color changes by
  rules”, “Repeats for each item in deals”), and the canvas outlines the children. Settings use
  plain words with the exact HubSpot prop name beside them (**Color** · `variant`), a line of help
  under each (hide it from the ⋯ menu), color swatches and spacing / direction previews, **Filter
  settings** (press `/`) on components with many settings, and **You can also** tips that open
  Rules, CRM data, actions, show when or repeat in one click. The registry got a plain-language
  pass (Flex is labelled **Layout box**; prop names and values are unchanged).
- **When HubSpot says no, the builder says what to do.** A sign-in window that closes or times out
  asks **What did HubSpot show?** (Acceptable Use Policy, not allowed to install apps, closed it,
  closed by itself, something else) and gives the fix, links and a note to copy for whoever set up
  the builder or a Super Admin — in the top bar and now also in the guided setup, which also says
  **Still waiting for HubSpot…** after 30 s. A blocked pop-up is one click from **Continue in this
  tab** (it no longer redirects on its own).
- **Publishing checks the key first.** `POST /api/deploy/check-key` reads the key's account and its
  *Developer projects* permission before anything is uploaded (the real logs showed four 403s in a
  row). The Publish dialog checks a pasted key by itself and explains each problem with the
  accounts involved: missing permission (open that account's key page, **Check again**, **Publish
  anyway**), a key from another account, `ALLOWED_PORTALS`, HubSpot's own 403 (with a note for a
  Super Admin). Key checks are rate limited like deploys.

**For whoever hosts the builder**

- **Status page at `/status`** (admins in `ADMIN_EMAILS` / `ADMIN_PORTALS` only): sign-ins that
  never came back (with what the visitor said HubSpot showed), refused publishes grouped with a
  count, failed builds, refused requests and errors in visitors' browsers — each with what it
  means, who can fix it and the steps. In memory only (resets on restart or sleep); every event
  is also an `[event] {json}` log line. Admins get a **Status page** link in the account menu.
  Editor crashes and sign-in feedback are now reported; failed sign-in pages carry their code in
  `X-UIEX-Error-Code`; Vercel passes the admin settings; `npm run dev:full` / `start:demo` make the
  fake portal an admin. Guide: `docs/STATUS-PAGE.md`; HOSTING.md has a short section and
  Troubleshooting starts with “Open `/status` first”.

**For power users**

- **Show when** and the If step are a visual condition builder (is / is not, more / less than,
  contains, is empty, true / false, grouped with *and* / *or*, compare with a fixed value or another
  value), saved as plain expressions and recognised again.
- **Filter, sort & limit** any list (Advanced › Repeat, a data source's **Filter & sort**, Data ›
  Computed, the palette) with a live preview of the rows and formats (currency, number, percent,
  date, relative date); fields show plain names (**Deal name**, **Amount**).
- **Rules in actions**: alert type, title and message, a variable's new value, the text to copy.
- **Copy / Paste settings** (⌥⌘C / ⌥⌘V, the ⋯ menu, right-click, Advanced › Reuse settings) and
  **multi-select** (Shift / Cmd / Ctrl-click on the canvas or in Layers): the inspector edits what
  they share, Delete removes them all in one undo step, Escape keeps one.
- Fixed on the way: Rules on CRM booleans never matched (`'true'` vs `true`); shaped lists of
  untyped fetch results failed the strict type-check of the exported card.

**Found and fixed while integrating** (looking at the production build as an admin and a power
user)

- Sorting **Associated records** by Amount put $7,800 before $48,000: lists that feed tables use
  HubSpot's formatted values ("$48,000.00"), which sorted as text. Such values now sort as numbers
  (a new `formatted` sort), text sorts start A → Z, and the list editor shows plain field names
  (**Deal name**, **Amount**, **Record ID**) instead of `dealname` / `toObjectId`.
- Each sign-in counted twice against the per-address limit (start and return shared one bucket),
  so about 10 sign-ins from one office address within minutes hit “Too many sign-in attempts”; the
  connector e2e suite failed on it. Start and return now have separate buckets.
- The guided setup now offers **What did HubSpot show?**, **Continue in this tab** for a blocked
  window and “Still waiting…” help (only the top bar had them); multi-selection got its gestures
  (Shift / Cmd / Ctrl-click on canvas and Layers, outlines, ⌥⌘C / ⌥⌘V, ⋯ menu and right-click
  items, Delete for all selected); the status page got its account-menu link, editor-crash and
  sign-in-feedback reports, the auth-page error header and Vercel settings; key checks are rate
  limited.
- Alert-type Rules start ready-made (success from 80, warning from 40, otherwise error) instead of
  “Success” everywhere; swatch tooltips no longer repeat the value (“Blue (info) (info)”); Reuse
  settings says how to select several components.

**Gate results**

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean |
| `npx vitest run` | 137 files, 2,864 tests, all passing |
| `npm run build` | Builds the app and `dist-server/` |
| `npx playwright test` | 37 passed, twice (new: `e2e/ease.spec.ts`, `e2e/power.spec.ts`) |
| `npm run e2e:connect` | 20 passed, twice (new: `trouble.spec.ts`, `status.spec.ts`) |

New end-to-end specs: `e2e/ease.spec.ts`, `e2e/power.spec.ts` (show when, filter / sort / limit,
copy settings and multi-edit, alert type rules), `e2e-connect/trouble.spec.ts` (HubSpot's install
refusals, blocked window, key problems, 403) and `e2e-connect/status.spec.ts` (sign in to `/status`,
refused key checks explained, the account-menu link). Screenshots (1440×900, light and dark):
`/tmp/claude-0/-home-user-Uiexbuilder/b04d6910-2b0e-5666-9061-79969b6019f7/scratchpad/improve/final/`.

**Still open (honestly)**

- **No dark theme for the builder itself.** Only `/status`, `setup.html` and the fake HubSpot pages
  follow the system's dark mode; the editor stays light (its CSS still has ~200 hard-coded colors).
  Dark screenshots of the editor therefore look like the light ones.
- **Not verified against real HubSpot**: the scope-group name used to read *Developer projects*
  from a key (a wrong name only gives the soft “missing permission” verdict, which has **Publish
  anyway**), and the exact wording and placement of HubSpot's in-window install refusals and of the
  user-permission paths (written from HubSpot's docs). The status page's history lives in memory
  (per instance on Vercel / Cloudflare).
- Tables are still edited level by level (no columns-and-rows editor); inputs still have long
  inspectors (filter and tips help); a list is sorted by one field only; formatting a single value
  outside a list still needs an expression or Rules; contradictory checks in one *and* group (e.g.
  “is true” and “is false”) aren't blocked and make the exported TSX fail its type-check.
- Multi-selection acts on all selected components for settings, paste settings and Delete; other
  actions (duplicate, copy, move, wrap) still act on the primary one.
- Optional ideas not done: Rules for a status line based on a sibling progress bar's percentage;
  “Drag components here” for empty containers.
- A WIP commit (`4f254e4`) appeared in the repository during this integration run; it was not made
  by the integrator, and nothing was committed afterwards.

## 2026-10-16 — first-run experience shipped; broad QA paused to save usage

- Done: security and UX fixes, the first-run experience (welcome, guided connect, tour), and a
  usability pass as a brand-new admin. The full gate passed: `tsc -b`, 2,658 unit tests, the build,
  30 Playwright tests and the connector e2e suite (twice).
- Closing the HubSpot sign-in window without a result now explains the likely causes (policy not
  signed by the host, a Super Admin needs to connect first). After deploying the connector app, the
  next steps include signing HubSpot's Acceptable Use Policy, and so does `/setup.html`.
- Paused at the owner's request (usage): four of the six QA reviews (HubSpot correctness and docs,
  visual and accessibility, a click-through of every control, error handling and security) and
  their fixes. The workflow can resume where it stopped.

_Last updated: 2026-10-16. A usability test (a brand-new, non-technical admin role-played end to
end against the production build + fake HubSpot) found 20 hesitations; the fixes are in and the
journey was re-run until every task was smooth. Earlier notes further down are history._

## Latest: usability pass — first-time admin journey (2026-10-16)

**Method:** Playwright against `scripts/dev.mjs --fake --prod` (production build, fake portal
12345678), fresh storage, a screenshot at every step (looked at, not just saved), clicks counted
per task. Tasks: (1) a card with a real contact's name, email and lifecycle stage and a working
**Copy email**, previewed with live data; (2) add a table of the contact's associated deals with a
loading state; (3) publish with the in-app guide (demo key) and follow the post-publish checklist;
(4) come back the next day (reload) and continue.

| Task | Before | After |
| --- | --- | --- |
| Connect HubSpot | 3 clicks | 3 clicks |
| 1 Contact card + Copy email (after connecting) | 7 clicks; the first record *looked* picked but wasn't; the selected name showed a code expression in the inspector; two “copied” alerts | **6 clicks**; the most recent contact is picked by itself; nothing selected (card settings in plain words); one alert |
| 2 Associated deals with a loading state | 4 clicks + 2 searches (Blocks: no match); the table landed inside the name column (undo + drag); no way to add a loading state | **3 clicks** (Templates › **Associated records**): heading, loading spinner, error + Try again, table of real deals, “none yet” — at the end of the card |
| 3 Publish + checklist | 12 clicks + scrolling for the key field and the Publish button; the 3 checklist links opened JSON error pages; 3 manual ticks; no way to finish | **9 clicks**, no scrolling (sticky Publish button); links open demo stand-ins and tick themselves; “All done” + **Done** |
| 4 Next day | 0 clicks to resume; re-publishing showed the whole key tutorial again | 0 clicks to resume; “Last published … · 3 of 3 done”, “You’ve changed your cards since then”, key steps folded (edit + republish: 8 clicks) |

**Fixed at the root:**

- Click-to-add / blocks go to the end of the card's main column when nothing is selected, and
  full-width components (tables, CRM data, charts, forms…) never squeeze into a row next to the
  selection (`smartInsertTarget`); finishing the setup leaves the selection empty.
- **Associated records** data block (new `BlockTemplate.create` contract: blocks that bring their
  data source); “No blocks match” offers **Search components for …**; Association table says HubSpot
  shows its loading state; `objectTypeId` reads **Record type** / **Associated records**.
- Contact summary starter reads named computed values (`{{ fullName }}`, `{{ lifecycleStage }}` …)
  instead of long expressions; custom lifecycle stages show their value.
- Preview: no duplicate “Copied to clipboard (preview)” when the handler shows its own alert.
- Design canvas: “Hidden right now” (was “Hidden by condition”); faded (not sliced) breadcrumbs;
  coach marks beside the sidebars sit below the card.
- Setup step 3 picks the most recent record (real data by default); the record search's
  keyboard-active row no longer looks picked when the search isn't focused.
- Publish dialog: sticky footer with the target account and **Publish to HubSpot**; one-line key
  steps (folded for returning publishers); plain progress messages; success names the card and
  the account; numbered placement clicks; links tick their step; “All done”; **Done**; a new
  publish keeps one-time ticks; “Last published …” and “changed since then”.
- Fake HubSpot: stand-in pages for install / settings / record / record list / project.
- Inspector: “Advanced: project files” (uid) starts collapsed.

**Screenshots** (1440×900 unless noted): `…/scratchpad/usability/b-*` (baseline), `a-*` (first
iteration), `f-*` (final run; `f-x-*` 1024×680). The connector suite now has
`e2e-connect/usability.spec.ts` (the whole journey, with the click budget's key assertions).

**Gate results:**

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean |
| `npx vitest run` | 116 files, 2,658 tests, all passing |
| `npm run build` | Builds the app and `dist-server/` |
| `npx playwright test` | 30 passed |
| `npm run e2e:connect` | 14 passed, twice (new: `e2e-connect/usability.spec.ts`) |

**Not changed (noted):** the toolbar still says “Live data” twice (Mock | Live switch and the
record chip); “You’re connected” still needs one **Next**; the loading spinner can only be seen
striped in Design (live data loads too fast to catch in Preview) — Data › Mock data › Simulate
shows it with mock data.

## First-run experience for brand-new admins (2026-10-16)

**Gate results:**

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean |
| `npx vitest run` | 116 files, 2,647 tests, all passing |
| `npm run build` | Builds the app and `dist-server/` |
| `npx playwright test` | 30 passed, twice (new: `e2e/first-run.spec.ts` — welcome on a first visit, sample-data path into the editor, tour skip / replay, no welcome on return, Help › Getting started) |
| `npm run e2e:connect` | 13 passed, twice (new: `e2e-connect/first-run.spec.ts` — Connect my HubSpot → sign in → where the card appears (custom objects listed) → a real record + a starter from the portal's properties → the editor previews live data; Publish wizard checklist) |

**What a new admin sees** (`src/onboarding`, details in ARCHITECTURE.md §9):

- **Cold start**: `index.html` shows a pure HTML/CSS “Waking up the builder…” splash until the app
  mounts (a note about free-plan naps after 4 s, a reload hint after 45 s).
- **Welcome** (first visit only; never again once completed or skipped; returning users with
  saved projects never see it; **Help › Getting started** reopens it): one-line promise,
  **Connect my HubSpot** (recommended; disabled with a one-line reason on the static copy, while
  sign-in isn't set up, or when the server can't be reached) and **Try it with sample data**, plus
  “I know what I’m doing → open the editor”.
- **Guided setup** (progress dots, Back / Next / Skip setup, keyboard friendly, survives a reload or
  a full-page sign-in): 1 Connect (the consent explainer in place, the existing popup flow,
  “Connected to acmedemo.com”); 2 Where should your card appear (contacts / companies / deals /
  tickets + the portal's custom objects by label; middle of the record page, right sidebar,
  preview panel, help desk — tickets only — with small pictures); 3 a real sample record (search,
  optional) and **Start from…** (a “<Type> details” card built from the portal's real properties,
  matching ready-made cards that fit the place, Blank). Finishing creates the card with that type
  and place, selects the record, switches the preview to Live data and opens the editor.
- **Tour**: 4 non-blocking coach marks (add components, edit, preview with real data, publish);
  Next / Skip tour / Escape; replay from **Help › Take the tour**.
- **Plain language**: **Publish** (top bar) / **Publish to HubSpot** instead of Export / Deploy;
  “card” / “cards and pages” instead of extension(s); uid only under “Advanced: project files”
  with an explanation; Code / Problems / Console start collapsed (remembered).
- **Publish to HubSpot wizard**: 1 Get your key — a direct link to the connected account's personal
  access key page (`https://app.hubspot.com/personal-access-key/<portalId>`, exactly what
  `@hubspot/cli` 8.16 opens; `/l/personal-access-key` when the account isn't known); 2 Publish with
  a progress bar; 3 **Finish in HubSpot** checklist with direct links (install the app, add the
  card to the record page with the exact clicks for its object and place, open the sample record)
  — ticks remembered per project. Failures list **What to do next**.
- **Fix-it buttons**: missing permission → **Reconnect to grant access** (record search, live-data
  problems, property pickers); expired sign-in → **Reconnect** (toast and notes).
- Also fixed: choosing an item in a top-bar menu no longer makes a quick second click on the same
  menu do nothing (found by the e2e suite).

**Screenshots** of every step (1440×900, plus 1024 and 390 wide) were taken and reviewed; the
connector suite saves them with `CONNECT_SCREENSHOTS=<dir>` (`frx-*.png`).

**Not verified here** (needs a real HubSpot account): the record-customization click path and the
`/settings/<portalId>` link in the checklist were written from HubSpot's documentation, not
clicked through; the personal access key URL is taken from the HubSpot CLI source.

**Next (optional)**: an agent usability test (a first-time admin role-played end to end on the
hosted app), then push and redeploy Render.

## Latest: security and first-time-admin review fixes (2026-10-16)

Two independent reviews reported 27 findings (sec-1..sec-7, ux-1..ux-20). Each was reproduced and
fixed at the root, with regression tests.

**Gate results:**

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean |
| `npx vitest run` | 111 files, 2,523 tests, all passing |
| `npm run build` | Builds the app and `dist-server/` |
| `npx playwright test` | 27 passed, twice |
| `npm run e2e:connect` | 12 passed, twice (new: trust prompt while connected, deploy needs sign-in, private-app token, SESSION_SECRET missing + setup page) |

**Security (behaviour changes):**

- Deploy: the personal access key is never stored ("remember" is gone). Once sign-in is set up,
  deploying needs a signed-in session (grant re-checked with HubSpot) and the key must belong to
  that account. Deploy jobs are bound to the browser that started them (HttpOnly cookie), followed
  with `POST /api/deploy/status`, redacted from logs, and the queue step is safe to replay.
- Imported projects: while HubSpot is connected, the trust prompt says plainly that trusted code can
  read the connected account's CRM data, and a project trusted before connecting is asked about
  again. (Residual risk: code the admin trusts still runs in the builder's page; a sandboxed
  opaque-origin preview is the next step.)
- Fetch proxy: Node checks every DNS answer and pins the connection (`server/guardedFetch.ts`);
  IPv6 is allowlisted to global unicast without NAT64/Teredo/6to4; unsafe ports refused; rate limited.
- `ALLOWED_PORTALS` restricts sign-in and deploy to listed HubSpot accounts.
- Rate limits on sign-in start/callback, deploy and the proxy.
- `__Host-` cookies on https; duplicate cookie names read as signed out; a copied cookie stops
  working within 5 minutes of Disconnect (immediately for deploys).
- `npm run dev` listens on localhost only; loopback fetches only for a browser on the same computer;
  no localhost redirect URL in the production app template.

**First-time admin (behaviour changes):**

- CRM components (property list, highlight, stage tracker, association tables, deadline) show the
  sample record's real values in Live mode; others say "Sample values". Deal stages show labels for
  custom pipelines.
- Deploy tab: explains a missing `SESSION_SECRET` (links `/setup.html`), recognises `pat-` tokens,
  connector-app success steps (policy, Client ID/secret), Install as the primary action, failed
  builds name the card and offer the builder file. Export opens on the Deploy tab.
- Connect: toasts after connect / disconnect / expiry, a visible "Waiting for HubSpot" panel with
  Start again / Cancel, give-up after 60 s, Super Admin note in the consent dialog, admin-friendly
  "not switched on yet" copy, clearer missing-permission copy with "Use mock data".
- Live data: the picker opens when switching to Live, the choice survives a reload of an unsaved
  starter project, the demo user is Sam Rivera, property suggestions show name and group on a
  second line.
- Docs: HOSTING.md, setup.html (SESSION_SECRET warning, Developer projects, Acceptable Use Policy,
  `ALLOWED_PORTALS`), README and ARCHITECTURE.md updated. The demo has a fake personal access key
  page.

**Additive contract changes:** see ARCHITECTURE.md §8 "Contracts".

## Connector integrated (2026-10-16)

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
| Security and first-time-admin reviews, then fixes | whole repo | **Done** (2026-10-16, see the top of this file) |

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

### First-run experience for brand-new users — done 2026-10-16 (see the top of this file)

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
