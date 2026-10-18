# The status page

A private page for the person who hosts the builder: **how sign-ins and publishes went for the
people using it, and any errors — in plain words**, with what each problem means and how to fix
it. No digging through your host's logs.

Open it at **`/status`** on your builder, for example `https://uiex-builder.onrender.com/status`.

## Turn it on (2 minutes)

Only people **signed in with HubSpot** whose HubSpot login email is in the setting `ADMIN_EMAILS`
can open it. Until that setting exists, nobody can — the page then shows your email and the exact
steps for your host.

1. Open `/status` and click **Sign in with HubSpot** (the same sign-in as the builder).
2. The page shows the value to copy, for example `ADMIN_EMAILS` = `you@example.com`.
3. Add it on your host:
   - **Render**: dashboard.render.com → your service → **Environment** → **Add Environment
     Variable** → Key `ADMIN_EMAILS`, Value your email → **Save, rebuild, and deploy**.
   - **Vercel**: Project → **Settings → Environment Variables** → add `ADMIN_EMAILS` (Production)
     → **Deployments → ⋯ → Redeploy**.
   - **Cloudflare**: Workers & Pages → your builder → **Settings → Variables and Secrets** → add
     `ADMIN_EMAILS` (Text) → **Deploy**.
   - **Docker / any Node.js host**: add `ADMIN_EMAILS=you@example.com` to the environment and
     restart.
   - **Your computer**: add `ADMIN_EMAILS=you@example.com` to `.env.local`, or start with
     `ADMIN_EMAILS=you@example.com npm run dev`.
4. Back on `/status`, click **I've added it — check again**.

Several admins: separate emails with commas. To let **everyone signed in to a HubSpot account**
in, use `ADMIN_PORTALS` with the account id (for example `ADMIN_PORTALS=12345678`) instead of, or
as well as, `ADMIN_EMAILS`.

| Setting | What it does |
| --- | --- |
| `ADMIN_EMAILS` | HubSpot login emails that may open the status page (comma separated, any case). |
| `ADMIN_PORTALS` | HubSpot account ids whose signed-in users may open it. |
| `LOG_EVENTS` | Node server only: write one `[event]` line per event to the log (default `true`). |

## What the page shows

- **At a glance** — for the last hour or the last 24 hours: sign-ins (signed in, failed, never came
  back, in progress), publishes (published, failed, key problems, in progress) and errors (refused
  requests, server errors, errors in visitors' browsers).
- **Needs your attention** — problems grouped and ranked by impact, each with *what it means*,
  *who can fix it* and *the steps*. Examples:
  - **Sign-in blocked: HubSpot wants the app's Acceptable Use Policy signed.** HubSpot shows this
    inside its sign-in window and never sends the visitor back; until the policy is signed nobody
    can connect.
  - **Sign-ins never came back.** Someone opened HubSpot's sign-in window and HubSpot never sent
    them back within 10 minutes. The page lists the usual causes in order: the Acceptable Use
    Policy, a visitor who isn't allowed to install apps (the first person from each HubSpot account
    must be a Super Admin), the 25-account install limit of unlisted apps, or simply a closed window.
    When the visitor told the builder what HubSpot showed, the page says so.
  - **Publish refused: the key is missing the "Developer projects" permission** — with how often it
    happened in a row.
  - Publishes that failed while HubSpot was building or making them live, errors in visitors'
    browsers (and whether they came from an older version of the builder), server errors.
- **Timeline** — every event, newest first: filter by sign-ins / publishes / errors, by time, only
  problems, or search for a code, visitor or account id. Click a row for the explanation and the
  details (code, request, how long it took, the browser error's stack …).
- **This server** — when it started, version and commit, whether sign-in and publishing are on,
  `ALLOWED_PORTALS`, who the admins are, how many events are kept.
- **Download** — everything on the page as a JSON file, to share with a developer.

The page refreshes every 30 seconds while it is open. It follows your system's light or dark mode.

## It resets: the history lives in memory

There is no database. The server keeps the last **600 events** in memory, so the page starts empty
whenever the server **restarts, redeploys or (free plans) goes to sleep** after 15 minutes without
visitors. The page says when the server started.

Every event is also written to your host's log as one line starting with `[event]`, so older
history is one search away (Render: your service → **Logs** → search `[event]`):

```
[event] {"at":"2026-10-18T09:12:41.000Z","kind":"publish.failed","outcome":"failed","repeat":4,"code":"missing_scope","status":403,"route":"POST /api/deploy","stage":"upload","visitor":"3f9a2c","portalId":12345678}
[event] {"at":"2026-10-18T09:20:03.000Z","kind":"signin.abandoned","outcome":"warning","update":true,"durationMs":600000,"mode":"popup","visitor":"a81c07"}
```

On **Vercel and Cloudflare** the connector runs as several short-lived instances; each keeps its own
list, so the page may show only part of the activity (the page says so). Their own log search finds
the `[event]` lines of all instances.

## Privacy

- Recorded: sign-ins, publishes, refused requests and errors in visitors' browsers — **codes,
  statuses and request patterns** (`GET /api/crm/records/:objectType/:id`, never the actual
  address, which could contain record ids), never messages that might repeat what someone typed.
- Visitors are an **anonymous 6-character id**: a hash of their IP address with a random secret
  that only lives in the server's memory and changes every day (so ids can't be traced back or
  linked across days), plus the **HubSpot account id** they signed in to. No names, emails or IP
  addresses are kept.
- **Never** tokens, personal access keys, cookies, OAuth codes or CRM records. Deploy job ids and
  the OAuth state are only kept as one-way hashes, to connect "started" with "finished".
- Browser errors are cleaned twice (in the browser and on the server): URLs lose their query
  strings, email addresses and anything that looks like a token are masked, messages and stacks are
  cut short. Errors from the visitor's own card code in the preview and from browser extensions are
  not reported.
- Only admins can open the page or its data (`/api/admin/diagnostics`); everyone else — signed out,
  or signed in but not an admin — sees nothing about other people's activity.

## For developers

| Route | Who | What |
| --- | --- | --- |
| `GET /api/admin/access` | anyone (CSRF header) | `AdminAccess`: sign-in set up? signed in? admin? admins configured? (no events) |
| `GET /api/admin/diagnostics` | admins | `DiagnosticsSnapshot`: counters, events, server settings |
| `POST /api/diagnostics/report` | anyone (CSRF header, ≤ 8 KB, 20 per visitor then 1 per 30 s) | a browser error, or what the sign-in window showed (`signin_feedback`) |

- Contract: `src/status/types.ts` (types only, compiled by both sides).
- Server: `server/core/diagnostics/` — `log.ts` (ring buffer, per-minute counters, one row per
  sign-in / publish updated in place, merged repeats), `observe.ts` (turns each answered `/api`
  request into events; `server/core/index.ts` calls it once per request), `routes.ts`,
  `sanitize.ts`, `visitor.ts`, `access.ts`. The Node server passes a single-process log and
  concludes abandoned sign-ins every minute.
- Browser: `src/status/` — `StatusPage.tsx` (access states), `Dashboard.tsx`, `explain.ts` (plain
  language, reusing `src/connect/describe.ts`, `src/connect/signInHelp.ts` and
  `src/panels/deploy/model.ts`), `model.ts` (filters, grouping, ranking), `reporter.ts` (window
  `error` / `unhandledrejection`, `reportReactError` for error boundaries, `reportSignInFeedback`;
  deduplicated, throttled, only when the builder has its server). `src/main.tsx` installs the
  reporter and shows the page on `/status`.
