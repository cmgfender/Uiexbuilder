# Put UI Extension Builder online, with "Connect HubSpot"

This guide is for the person who sets the builder up **once** - an ops, RevOps or IT person. You do
not need to write code. Expect about 30 minutes.

When you are done, you have one web address (for example `https://uiex-builder.onrender.com`).
HubSpot admins open it in their browser, click **Connect HubSpot**, approve, and from then on the
builder shows their **real** records, properties and pipelines. They never install anything and
never open a terminal.

**Contents**

1. [What you need](#what-you-need)
2. [Step 1 - Put the builder online](#step-1---put-the-builder-online) (Render or Vercel, one click)
3. [Step 2 - Create the HubSpot app](#step-2---create-the-hubspot-app)
4. [Step 3 - Add the HubSpot settings to your host](#step-3---add-the-hubspot-settings-to-your-host)
5. [Step 4 - Check it works](#step-4---check-it-works)
6. [Step 5 - Share the address with admins](#step-5---share-the-address-with-admins) (and what they see)
7. [Troubleshooting](#troubleshooting)
8. [Security and privacy](#security-and-privacy)
9. [Other ways to host](#other-ways-to-host) (Cloudflare, Docker, any Node.js host)
10. [All settings](#all-settings)
11. [For developers: run it on your computer](#for-developers-run-it-on-your-computer)

> **Shortcut:** once the builder is online, open **`https://<your address>/setup.html`**. That page
> checks whether sign-in is ready, shows your exact redirect URL, gives you the HubSpot app file
> already filled in, and links to a secret generator.

---

## What you need

- **A HubSpot account where you can create apps** - a Super Admin, or someone with developer access
  in the account that should *own* the app. (The app can still be used by any HubSpot account - see
  [who can connect](#who-can-connect).)
- **A free hosting account**: [Render](https://render.com) *or* [Vercel](https://vercel.com). Both
  let you sign in with GitHub.
- **A GitHub account** - the one-click buttons put a copy of the builder in your GitHub, so the host
  can update it for you.

How the pieces fit together:

```
Admin's browser ──► your builder address (Render / Vercel)
                        │   /       the builder itself
                        │   /api    the "connector": signs people in with HubSpot,
                        │           keeps their sign-in in an encrypted cookie,
                        │           and reads CRM data for previews (read-only)
                        ▼
                     HubSpot (sign-in page + CRM API)
```

HubSpot does not let web pages call its API directly, which is why the builder comes with this small
connector. It has no database: nothing about your CRM is stored on the server.

---

## Step 1 - Put the builder online

Pick **one** host. Render is the simplest. Vercel is just as good if your company already uses it.

### Option A: Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/cmgfender/Uiexbuilder)

1. Click **Deploy to Render** above and sign in (choose **GitHub** if asked).
2. On the **Create a new Blueprint Instance** page:
   - **Blueprint Name**: anything, e.g. `UI Extension Builder`.
   - The page lists the service `uiex-builder`. Its address will be
     `https://uiex-builder.onrender.com` (Render adds a few letters if that name is taken).
   - Render asks for **HUBSPOT_CLIENT_ID**, **HUBSPOT_CLIENT_SECRET** and **APP_URL**.
     **Leave all three empty for now** (or type `later`). You will fill in the HubSpot values in
     step 3. `APP_URL` can stay empty for good - Render tells the builder its own address.
   - **SESSION_SECRET** is created for you. Nothing to do.
3. Click **Deploy Blueprint** (on older screens: **Apply**). The first build takes 3-6 minutes.
4. When the service shows **Live**, click its name and **copy the address** shown under the
   name (it ends in `.onrender.com`). You need it in step 2.

> **Free plan:** the service goes to sleep after 15 minutes without visitors, and the next visit
> takes up to a minute to wake it. For a team, choose the **Starter** plan (service → **Settings**
> → **Instance type**) so it is always on.

### Option B: Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcmgfender%2FUiexbuilder&project-name=uiex-builder&repository-name=uiex-builder&env=APP_URL,HUBSPOT_CLIENT_ID,HUBSPOT_CLIENT_SECRET,SESSION_SECRET&envDescription=Type%20%22later%22%20in%20each%20box%20if%20you%20do%20not%20have%20the%20values%20yet.%20The%20builder%20works%20without%20them%3B%20only%20Connect%20HubSpot%20waits.&envLink=https%3A%2F%2Fgithub.com%2Fcmgfender%2FUiexbuilder%2Fblob%2FHEAD%2Fdocs%2FHOSTING.md%23step-3---add-the-hubspot-settings-to-your-host)

1. Click **Deploy with Vercel** above and sign in with **GitHub**.
2. **Create Git Repository**: keep the name `uiex-builder` (or choose another) and click **Create**.
   The project name becomes your address: `https://uiex-builder.vercel.app` (Vercel adds letters if
   the name is taken).
3. Vercel asks for four values: **APP_URL**, **HUBSPOT_CLIENT_ID**, **HUBSPOT_CLIENT_SECRET** and
   **SESSION_SECRET**. You do not have them yet - **type `later` in each box**. The builder treats
   `later` as "not set yet": it works, and only **Connect HubSpot** waits for the real values.
4. Click **Deploy** and wait about 2 minutes.
5. Click **Continue to Dashboard** and **copy the address** under **Domains** (it ends in
   `.vercel.app`).

> Use the address under **Domains** (your production address). The long addresses Vercel creates
> for each preview deployment cannot sign in to HubSpot.

---

## Step 2 - Create the HubSpot app

The HubSpot app is what admins approve when they click **Connect HubSpot**. You create it **once**.
It asks only for **read** permissions (see [scopes](../hubspot-app/README.md#scopes)).

Your **redirect URL** is your address followed by `/api/auth/callback`, for example
`https://uiex-builder.onrender.com/api/auth/callback`. The setup page shows it for you:
`https://<your address>/setup.html` → section 2 → **Copy**.

### Option A (no terminal): from the builder itself

1. Open `https://<your address>/setup.html` and click **Download the app file** (section 3). The
   file `hubspot-connector-app.uiex.json` already contains your redirect URL.
2. Create a **personal access key** in HubSpot: open
   [app.hubspot.com/l/personal-access-key](https://app.hubspot.com/l/personal-access-key), choose
   the HubSpot account that should own the app, then create the key (or show the one you already
   have) and **Copy** it.
3. Open your builder (`https://<your address>`). In the top bar click **Project** →
   **Import .uiex.json…** and choose the downloaded file.
4. Click **Deploy to HubSpot** (beta), paste the personal access key and click **Deploy**. Wait
   until it says the deploy succeeded.
5. Continue with [Copy the Client ID and Client secret](#copy-the-client-id-and-client-secret).

### Option B: with the HubSpot CLI

If someone on your team is comfortable with a terminal, the [`hubspot-app/`](../hubspot-app)
folder is the same app as a HubSpot developer project:

1. In `hubspot-app/src/app/app-hsmeta.json`, replace `YOUR-DOMAIN` with your address.
2. Run `npm install -g @hubspot/cli`, then `hs account auth`, then `cd hubspot-app` and
   `hs project upload`.

Details: [hubspot-app/README.md](../hubspot-app/README.md).

### Copy the Client ID and Client secret

In HubSpot, go to **Development** → **Projects** → **uiex-builder-connector** → click the app
**UI Extension Builder** → **Auth** tab. Copy the **Client ID** and the **Client secret** (click
**Show** first). Keep the secret private, like a password.

On the same tab, check that **Redirect URLs** contains your redirect URL exactly. If your address
ever changes, update the redirect URL in the app (re-import the file from `/setup.html`, or edit
the app's settings in the builder: **App** settings → **Redirect URLs**) and deploy the app again.

<a id="who-can-connect"></a>
### Who can connect?

The app uses `"distribution": "marketplace"`: **any HubSpot account can connect** from your builder.
It is not listed on the HubSpot Marketplace, so nobody else finds it.

Want to limit it to your own HubSpot accounts? Before you deploy the app for the first time, change
the distribution to **private** (builder: **App** settings → **Distribution**; CLI: `"distribution":
"private"` in `app-hsmeta.json`). Then add each allowed account in HubSpot: **Development** →
**Projects** → your app → **Distribution**. People from other accounts get an error when they try
to connect.

---

## Step 3 - Add the HubSpot settings to your host

You need three values:

| Setting | Value |
| --- | --- |
| `HUBSPOT_CLIENT_ID` | the Client ID from step 2 |
| `HUBSPOT_CLIENT_SECRET` | the Client secret from step 2 |
| `SESSION_SECRET` | 48 random characters (Render already made one). To make one, open `https://<your address>/secret.html` and click **Copy**. |
| `APP_URL` *(optional)* | your address, e.g. `https://uiex-builder.onrender.com`. Leave it empty (or `later`) on Render and Vercel unless you use your own domain. |

**Render:** open your service → **Environment** (left menu) → **Edit** → fill in
`HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` → **Save, rebuild, and deploy** (or **Save and
deploy**). Wait until the service is **Live** again.

**Vercel:** open your project → **Settings** → **Environment Variables**. For each of
`HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` and `SESSION_SECRET`: click **⋯** → **Edit**, replace
`later` with the real value, **Save**. Then go to **Deployments**, open the **⋯** menu of the newest
deployment and click **Redeploy** - Vercel only picks up new values after a redeploy.

**Using your own domain** (e.g. `builder.yourcompany.com`): add it in your host's **Custom
Domains** settings, set `APP_URL` to `https://builder.yourcompany.com`, and add
`https://builder.yourcompany.com/api/auth/callback` to the HubSpot app's redirect URLs.

---

## Step 4 - Check it works

1. Open `https://<your address>/setup.html`. Section 1 should say **Ready. Admins can open the
   builder and click Connect HubSpot.**
   - If it says **Almost there**, one of the three settings is missing or still says `later`.
     Re-check step 3 (and on Vercel, that you redeployed).
2. Want the raw check? Open `https://<your address>/api/health`. You should see
   `"ok":true` and `"oauthConfigured":true`.
3. Open the builder, click **Connect HubSpot**, approve in the window that opens, and check that
   the builder shows **Connected to** your HubSpot account.

Something wrong? See [Troubleshooting](#troubleshooting).

---

## Step 5 - Share the address with admins

Send admins the address, for example:

> Design HubSpot cards here: https://uiex-builder.onrender.com - click **Connect HubSpot** (top
> right) to preview with our real CRM data. It only reads data.

### What admins see

1. They open the address. The builder works right away with sample (mock) data.
2. They click **Connect HubSpot**. A HubSpot window opens. They sign in if needed, pick the HubSpot
   account, and see the list of permissions (all **read**). They click **Connect app**.
   - The first person in each HubSpot account installs the app for that account. HubSpot only lets
     **Super Admins** or users with **App Marketplace access** do that; if someone sees a permission
     message, ask a Super Admin to connect first (or to grant that permission).
3. The window closes and the builder shows **Connected to** the account.
4. They pick a **sample record**; the preview shows its real values, associations and search
   results. Property, object and pipeline pickers list the account's real properties (including
   custom ones), labels and dropdown options. They can switch back to mock data at any time.
5. **Deploy to HubSpot** (beta) uploads what they built, using a personal access key they create
   in HubSpot ([app.hubspot.com/l/personal-access-key](https://app.hubspot.com/l/personal-access-key)).
   No terminal needed.
6. **Disconnect** signs them out of HubSpot in the builder.

---

## Troubleshooting

| What you see | What it means | How to fix it |
| --- | --- | --- |
| `/setup.html` says **Almost there**, or the builder says Connect HubSpot **isn't set up** | A setting is missing, too short, or still a placeholder | Step 3. `SESSION_SECRET` needs at least 32 characters. On Vercel, **Redeploy** after changing settings. On Render, wait until the service is **Live** again. |
| `/setup.html` says **no HubSpot connector** | The builder is running as plain files (for example GitHub Pages or `vite preview`) | Use one of the hosts in this guide. Plain file hosting cannot sign in to HubSpot. |
| HubSpot shows an error about the **redirect URI / redirect URL** | The address in the HubSpot app does not match exactly | Open `/setup.html` on the address people use, copy the redirect URL and make the app's **Redirect URLs** contain exactly that (`https://`, no extra `/`). If you use your own domain, `APP_URL` must be that domain too. |
| HubSpot says the **scopes** do not match, or the app "requested scopes it is not allowed to" | The scope lists of the app and the connector differ | Use the defaults everywhere, or set `HUBSPOT_SCOPES` / `HUBSPOT_OPTIONAL_SCOPES` to exactly the app's required / optional scopes. |
| The builder says a **permission is missing** (e.g. tickets, custom objects) | That account did not grant an optional permission, or its HubSpot plan has no such data | Click **Disconnect**, then **Connect HubSpot** again and approve all permissions. Some objects (custom objects, quotes) need a paid HubSpot plan. |
| The person sees a HubSpot message about **not being allowed to install apps** | Only Super Admins or users with App Marketplace access can install apps | A Super Admin connects once (installs the app for the account) or grants **App Marketplace access** in HubSpot **Settings → Users & Teams**. |
| **EU accounts**: the HubSpot window keeps loading, or says the account cannot be found | The account is hosted in HubSpot's EU data centre | Add the setting `HUBSPOT_APP_BASE` = `https://app-eu1.hubspot.com` and redeploy. |
| Connect works, but the builder immediately shows **not connected** again | The browser is not keeping the builder's cookie | Allow cookies for the builder's address (strict privacy settings or extensions can block them). Use the exact address in `APP_URL`, over `https://`. On Vercel, use the production address, not a preview address. |
| **This website is not allowed to use the HubSpot connector** | The builder was opened on a different address than `APP_URL` | Open the builder on its `APP_URL` address, or add the other address to `ALLOWED_ORIGINS`. |
| The HubSpot window does not open | The browser blocked the pop-up | Allow pop-ups for the builder's address and click **Connect HubSpot** again. |
| The first visit is very slow (Render) | The free plan sleeps after 15 minutes | Choose the **Starter** plan, or wait up to a minute. |
| **Deploy to HubSpot** says the key is not valid | Wrong, deleted, or another account's personal access key | Create a new key in the account you are deploying to and paste it again. |
| Render's deploy fails with a **health check** error | The server did not start | Open **Logs** in Render. The start-up message lists what is set and what is missing (never the secret values). |

---

## Security and privacy

- **Read-only.** The app asks only for `.read` scopes (plus `oauth`, which HubSpot requires). The
  connector only offers read endpoints. It cannot create, change or delete anything in HubSpot.
- **What is read, and when.** Only what someone looks at while building: the sample record they
  pick (and its associations), search results, property definitions, object types, pipelines and
  owners. Nothing is copied to a database - there is no database.
- **Tokens stay on the server side.** HubSpot's access and refresh tokens are kept in an
  **encrypted cookie** (AES-GCM, with a key derived from `SESSION_SECRET`) that is `HttpOnly`
  (page scripts cannot read it) and `Secure` on `https://`. The browser never sees the tokens; the
  connector refreshes them automatically and revokes them on **Disconnect**.
- **Requests must come from the builder.** API calls need a special header and must come from the
  builder's own address (`APP_URL`, plus any `ALLOWED_ORIGINS`), which blocks other websites.
- **Personal access keys** (Deploy to HubSpot) are used for that deploy only. If someone ticks
  "remember", the key is kept in the same encrypted cookie in *their* browser, nowhere else.
- **Preview fetch proxy.** Cards that call outside APIs (`hubspot.fetch`) can be previewed through
  the connector. It refuses private and internal network addresses. Turn it off with
  `ENABLE_FETCH_PROXY=false`.
- **Secrets.** Keep `HUBSPOT_CLIENT_SECRET` and `SESSION_SECRET` only in your host's settings.
  The server never prints them. Changing `SESSION_SECRET` signs everyone out (they just connect
  again). If the client secret leaks, rotate it in the HubSpot app's **Auth** tab and update
  `HUBSPOT_CLIENT_SECRET`.

**How to remove access**

- One person: click **Disconnect** in the builder.
- A whole HubSpot account: in HubSpot, click the **settings** (gear) icon → **Integrations** →
  **Connected apps** → **UI Extension Builder** → **Actions** → **Uninstall**. This revokes every
  token for that account.
- Everyone, everywhere: change `SESSION_SECRET` (signs everyone out) and remove or rotate the app's
  client secret in HubSpot.

---

## Other ways to host

All options run the same code: the builder plus the connector in one place.

### Cloudflare Workers

Good if your company already uses Cloudflare. Configuration is in [`wrangler.toml`](../wrangler.toml).

Without a terminal:

1. In the Cloudflare dashboard: **Workers & Pages** → **Create** → **Import a repository** → pick
   your copy of this repository (fork it on GitHub first).
2. Build command: `npm run build:app` · Deploy command: `npx wrangler deploy`. Click **Deploy**.
3. Your worker → **Settings** → **Variables and Secrets** → **Add**: type **Secret** for
   `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` and `SESSION_SECRET`. Optionally a **Text**
   variable `APP_URL` (otherwise the address requests arrive on is used, e.g.
   `https://uiex-builder.<you>.workers.dev`).

With a terminal: `npx wrangler deploy`, then `npx wrangler secret put HUBSPOT_CLIENT_ID` (and the
same for `HUBSPOT_CLIENT_SECRET` and `SESSION_SECRET`).

### Docker (any server or container platform)

```bash
docker build -t uiex-builder .
docker run -d --name uiex-builder -p 3000:3000 \
  -e APP_URL=https://builder.example.com \
  -e HUBSPOT_CLIENT_ID=... \
  -e HUBSPOT_CLIENT_SECRET=... \
  -e SESSION_SECRET=... \
  --restart unless-stopped uiex-builder
```

The image runs as a non-root user, needs no other services, and has a built-in health check
(`/api/health`). Put it behind your usual HTTPS proxy or load balancer; `APP_URL` must be the
public `https://` address. `docker logs uiex-builder` shows the start-up summary, including the
exact redirect URL to register in HubSpot.

### Any Node.js host (Railway, Fly.io, a VM, …)

Node.js 20.19 or newer:

```bash
npm ci
npm run build      # builds the app (dist/) and the server (dist-server/)
npm start          # serves both on $PORT (default 3000)
```

On Railway and Fly.io, `APP_URL` is detected automatically like on Render and Vercel.

---

## All settings

| Setting | Required | Default | What it does |
| --- | --- | --- | --- |
| `HUBSPOT_CLIENT_ID` | for sign-in | - | Client ID of your HubSpot app (Auth tab) |
| `HUBSPOT_CLIENT_SECRET` | for sign-in | - | Client secret of your HubSpot app |
| `SESSION_SECRET` | for sign-in | - | 32+ random characters; encrypts sign-in cookies. Make one at `/secret.html` or with `npm run secret` |
| `APP_URL` | on Docker / own domain | detected on Render, Vercel, Railway, Fly | The address people open, without a trailing `/` |
| `HUBSPOT_SCOPES` | no | read scopes for contacts, companies, deals and their properties | Required scopes, separated by commas or spaces (must match the app) |
| `HUBSPOT_OPTIONAL_SCOPES` | no | tickets, custom objects, owners, line items, products, quotes (read) | Optional scopes (must match the app) |
| `HUBSPOT_APP_BASE` | no | `https://app.hubspot.com` | HubSpot sign-in host. EU accounts with trouble: `https://app-eu1.hubspot.com` |
| `HUBSPOT_API_BASE` | no | `https://api.hubapi.com` | HubSpot API host |
| `ENABLE_FETCH_PROXY` | no | `true` | Preview `hubspot.fetch` calls through the connector |
| `ENABLE_DEPLOY` | no | `true` | Allow **Deploy to HubSpot** (beta) |
| `ALLOWED_ORIGINS` | no | - | Other addresses allowed to use the connector, comma separated |
| `PORT` | no | `3000` | Port for `npm start` / Docker |
| `LOG_REQUESTS` | no | `true` | Log one line per API request (paths only, never data or secrets) |

Placeholder values such as `later`, `todo` or `-` count as "not set".

---

## For developers: run it on your computer

| Command | What it does |
| --- | --- |
| `npm run dev` | Builder on http://localhost:5173 plus the connector. Without settings, Connect HubSpot shows as not set up - everything else works. Put real settings in `.env.local` (see `.env.example`) to sign in to a real account (add `http://localhost:5173/api/auth/callback` to the app's redirect URLs). |
| `npm run dev:full` | Same, plus a **fake HubSpot** with demo data on port 4010: try the whole Connect flow, sample records and Deploy to HubSpot without a HubSpot account. The fake personal access key is printed in the terminal. |
| `npm run build` then `npm start` | Production server on http://localhost:3000 |
| `npm run start:demo` | Production build + fake HubSpot on http://localhost:4174 (used for demos and end-to-end tests; run `npm run build` first) |
| `npm run secret` | Print a new `SESSION_SECRET` |

Code: the connector core is in `server/core` (standard Web `Request`/`Response`, no framework). The
hosting adapters are thin: `server/node.ts` (Node, Render, Docker), `api/[...path].ts` (Vercel),
`server/cloudflare.ts` (Cloudflare Workers).
