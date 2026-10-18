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

- **A HubSpot account where you can create apps** - one that shows **Development** in HubSpot's
  main menu (developer projects), where you are a Super Admin or have developer access. On HubSpot's
  current developer platform (2025.2 and later) that can be your company's normal HubSpot account;
  a free [developer account](https://developers.hubspot.com) works too. This account *owns* the app;
  other accounts can still connect - see [who can connect](#who-can-connect).
- **A free hosting account**: [Render](https://render.com) *or* [Vercel](https://vercel.com). Both
  let you sign in with GitHub.
- **A GitHub account** to sign in to the host. Vercel's button copies the builder into your GitHub
  (Vercel redeploys when that copy changes). Render's button deploys straight from the public
  repository - no copy needed; to update later, open the service and click **Manual Deploy** →
  **Deploy latest commit**.

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

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcmgfender%2FUiexbuilder&project-name=uiex-builder&repository-name=uiex-builder&env=APP_URL,HUBSPOT_CLIENT_ID,HUBSPOT_CLIENT_SECRET,SESSION_SECRET&envDescription=For%20SESSION_SECRET%20type%2048%20random%20letters%20and%20numbers%20%28a%20password%20manager%27s%20generator%20works%29%20-%20Deploy%20to%20HubSpot%20needs%20it.%20Type%20%22later%22%20in%20the%20other%20three%20boxes%20if%20you%20do%20not%20have%20the%20values%20yet%3B%20the%20builder%20works%20without%20them%2C%20only%20Connect%20HubSpot%20waits.&envLink=https%3A%2F%2Fgithub.com%2Fcmgfender%2FUiexbuilder%2Fblob%2FHEAD%2Fdocs%2FHOSTING.md%23step-3---add-the-hubspot-settings-to-your-host)

1. Click **Deploy with Vercel** above and sign in with **GitHub**.
2. **Create Git Repository**: keep the name `uiex-builder` (or choose another) and click **Create**.
   The project name becomes your address: `https://uiex-builder.vercel.app` (Vercel adds letters if
   the name is taken).
3. Vercel asks for four values: **APP_URL**, **HUBSPOT_CLIENT_ID**, **HUBSPOT_CLIENT_SECRET** and
   **SESSION_SECRET**.
   - **SESSION_SECRET**: type **48 random letters and numbers** now (your password manager's
     "generate password" button is fine; no spaces). **Deploy to HubSpot** in step 2 needs it.
   - The other three: you do not have them yet - **type `later`**. The builder treats `later` as
     "not set yet": it works, and only **Connect HubSpot** waits for the real values.
4. Click **Deploy** and wait about 2 minutes.
5. Click **Continue to Dashboard** and **copy the address** under **Domains** (it ends in
   `.vercel.app`).
6. **Typed `later` for SESSION_SECRET too?** Fix it now, before step 2: open
   `https://<your address>/secret.html` and click **Copy**. In Vercel open **Settings** →
   **Environment Variables** → `SESSION_SECRET` → **⋯** → **Edit**, paste, **Save**. Then
   **Deployments** → **⋯** of the newest deployment → **Redeploy**. (`/setup.html` shows a warning
   until this is done.)

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
   [app.hubspot.com/l/personal-access-key](https://app.hubspot.com/l/personal-access-key) and choose
   the HubSpot account that should own the app. Create the key (or show the one you already have) -
   **make sure the "Developer projects" permission is ticked** - and **Copy** it. It is a long code
   (it often starts with `CiR`); a code that starts with `pat-` is a *private app token*, not a
   personal access key.
3. Open your builder (`https://<your address>`). In the top bar click **Project** →
   **Import .uiex.json…** and choose the downloaded file.
4. Click **Publish** (top right). The **Publish to HubSpot** tab opens (beta). Paste the personal
   access key - the builder checks it with HubSpot right away and says which account it belongs to
   and whether it has **Developer projects** (if not, it links to that account's key page; add the
   permission and click **Check again**). Click **Publish to HubSpot** and wait until it says it is
   published.
   - The tab says it **needs SESSION_SECRET**? Do Step 1 → Vercel → step 6, then try again.
   - Deploying again later, once sign-in works? Click **Connect HubSpot** first - deploys then go
     to the account you are connected to.
5. Continue with [Accept HubSpot's Acceptable Use Policy](#accept-hubspots-acceptable-use-policy-once)
   (below), then [Copy the Client ID and Client secret](#copy-the-client-id-and-client-secret). The
   success screen lists these steps too.

### Option B: with the HubSpot CLI

If someone on your team is comfortable with a terminal, the [`hubspot-app/`](../hubspot-app)
folder is the same app as a HubSpot developer project:

1. In `hubspot-app/src/app/app-hsmeta.json`, replace `YOUR-DOMAIN` with your address.
2. Run `npm install -g @hubspot/cli`, then `hs account auth`, then `cd hubspot-app` and
   `hs project upload`.

Details: [hubspot-app/README.md](../hubspot-app/README.md).

Next: [Accept HubSpot's Acceptable Use Policy](#accept-hubspots-acceptable-use-policy-once), then
[Copy the Client ID and Client secret](#copy-the-client-id-and-client-secret).

### Accept HubSpot's Acceptable Use Policy (once)

**Do not skip this step.** HubSpot will not install a public (OAuth) app in *any* account - not even
your own - until the app's **developer** (you: the HubSpot account that owns the app) has signed the
**Acceptable Use Policy**. Until then, **Connect HubSpot** opens a HubSpot window that says *"The app
could not be installed because the app developer has not signed the acceptable use policy"*. HubSpot
shows this inside its own window and never sends the person back to the builder, so your server logs
only show sign-ins that start (`/api/auth/start`) and never finish (`/api/auth/callback`). The
builder then asks the person **What did HubSpot show?**; when they pick this message it explains
that you need to sign the policy and gives them a note to copy and send you.

1. In HubSpot go to **Development** → **Projects** → **uiex-builder-connector** → click the app →
   **Distribution** tab.
2. Click **Begin publishing**, review the Acceptable Use Policy and **sign** it. You do **not** have to
   finish a Marketplace listing: once the policy is signed the app can be installed in up to **25**
   HubSpot accounts without being listed.
3. Check it: open the builder in a private window and click **Connect HubSpot**. You should see
   HubSpot's permission screen, not the message above.

### Copy the Client ID and Client secret

In HubSpot, go to **Development** → **Projects** → **uiex-builder-connector** → click the app
**UI Extension Builder** → **Auth** tab. Copy the **Client ID** and the **Client secret** (click
**Show** first). Keep the secret private, like a password.

On the same tab, check that **Redirect URLs** contains your redirect URL exactly. If your address
ever changes, update the redirect URL in the app (re-import the file from `/setup.html`, or edit
the app's settings in the builder: **App** settings → **Redirect URLs**) and deploy the app again.

<a id="who-can-connect"></a>
### Who can connect?

The app uses `"distribution": "marketplace"` without a Marketplace listing: once the Acceptable Use
Policy is signed, **up to 25 HubSpot accounts** can install it (more needs a Marketplace listing;
after that HubSpot refuses new installs with an install-limit message in its window). Nobody finds it
on the Marketplace.

The **first person to connect from each HubSpot account installs the app** for that account, and
HubSpot only lets **Super Admins** (or users with **App Marketplace access**) install apps. Anyone
else sees a HubSpot message that they don't have permission; the builder tells them to ask a Super
Admin to connect once (and gives them a note to send). After that, everyone in that account can
connect.

**Recommended:** limit sign-in (and Deploy to HubSpot) to your own accounts with the server setting
`ALLOWED_PORTALS` - a comma-separated list of HubSpot account ids, for example `12345678,87654321`
(the account id is shown in the builder's account menu, and in HubSpot under your profile).
Anyone else who tries to connect sees *"This HubSpot account can't be used here"*, and the builder
gives their sign-in back to HubSpot right away.

Want to limit it to your own HubSpot accounts? Before you deploy the app for the first time, change
the distribution to **private** (builder: **App** settings → **Distribution**; CLI: `"distribution":
"private"` in `app-hsmeta.json`). Then add each allowed account in HubSpot: **Development** →
**Projects** → your app → **Distribution**. People from other accounts get an error when they try
to connect.

---

## Step 3 - Add the HubSpot settings to your host

- **Render**: two values - `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` (Render made
  `SESSION_SECRET` for you).
- **Vercel**: `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` (and `SESSION_SECRET` if it still says
  `later`).
- Recommended on both: `ALLOWED_PORTALS` (see [who can connect](#who-can-connect)).

| Setting | Value |
| --- | --- |
| `HUBSPOT_CLIENT_ID` | the Client ID from step 2 |
| `HUBSPOT_CLIENT_SECRET` | the Client secret from step 2 |
| `SESSION_SECRET` | 48 random characters (Render already made one). To make one, open `https://<your address>/secret.html` and click **Copy**. |
| `ALLOWED_PORTALS` *(recommended)* | the HubSpot account ids that may connect, e.g. `12345678,87654321`. Empty = any account that installs your app. |
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
3. Open the builder, click **Connect HubSpot** → **Continue to HubSpot**, approve in the window
   that opens, and check that the top right of the builder now shows your HubSpot domain (for
   example `acme.com`; wide screens also show the account number). Click it to see the account
   number and what the builder can see.

Something wrong? See [Troubleshooting](#troubleshooting).

---

## Step 5 - Share the address with admins

Send admins the address, for example:

> Design HubSpot cards here: https://uiex-builder.onrender.com - click **Connect HubSpot** (top
> right) to preview with our real CRM data. It only reads data.

### What admins see

1. They open the address. A short "Waking up the builder…" page shows while a free-plan server
   starts, then a **welcome screen**: **Connect my HubSpot** (recommended) or **Try it with sample
   data** (or *I know what I'm doing → open the editor*). Connecting walks them through three
   steps — sign in, choose where the card appears (record type, including their custom objects,
   and the place on the record page), pick a real record and a starting card — and opens the
   editor with their real data and a four-tip tour. **Help › Getting started** shows the welcome
   again; the rest of this list is the same flow from the editor.
2. They click **Connect HubSpot** (top right). The builder first explains, in plain words, what it
   can and cannot do (read-only; the exact permissions are one click away). They click
   **Continue to HubSpot**. A HubSpot window opens. They sign in if needed, pick the HubSpot
   account, and see the list of permissions (all **read**). They click **Connect app**.
   - The first person in each HubSpot account installs the app for that account. HubSpot only lets
     **Super Admins** or users with **App Marketplace access** do that; if someone sees a permission
     message, ask a Super Admin to connect first (or to grant that permission).
   - If the browser blocks the HubSpot window, the builder says so and offers **Continue in this
     tab** (one click: HubSpot opens in the same tab and comes back to the builder; their work is
     saved).
3. The window closes, a message says they are connected, and the top bar shows the account's
   domain (for example `acme.com`). Clicking it opens the account menu: account number, what the
   builder can see, **Switch account**, **Disconnect**.
   - While the HubSpot window stays open, the builder shows **Waiting for HubSpot…** with **Show
     HubSpot window** / **Start again** / **Cancel** and **Having trouble?**; after half a minute it
     says **Still waiting for HubSpot…** and asks what the window shows.
   - If the window closes without connecting, the builder asks **What did HubSpot show?** - a
     message about the *acceptable use policy*, *not allowed to install apps*, *I closed it*, *it
     closed by itself*, or *something else* - and gives the exact fix for each: the steps, the
     right links, **Continue in this tab**, and for problems only you (or a Super Admin) can fix, a
     **Copy a note for whoever set up this builder** / **for your Super Admin** button.
4. Above the card they choose **Live data** and **Pick a sample record** (search by name, email
   or ID); the preview shows its real values, associations and search results. Property, object
   and pipeline pickers list the account's real properties (including custom ones, marked
   **Custom**), labels and dropdown options. HubSpot's CRM components (property lists, data
   highlights, stage trackers, association tables) show the real record too; the few that can't
   (reports, statistics) say *Sample values*. **Mock data** switches back at any time. If
   something isn't included in their connection (for example tickets on a plan without them), the
   builder says so and offers **Reconnect to grant access** or **Use mock data**.
5. **Publish** (top right) opens on **Publish to HubSpot** (beta): it uploads what they built to the
   account they are connected to, using a personal access key they create in HubSpot
   ([app.hubspot.com/l/personal-access-key](https://app.hubspot.com/l/personal-access-key), with the
   **Developer projects** permission). They paste the key for every deploy - it is never saved. No
   terminal needed. The builder checks the key with HubSpot **before uploading anything**: which
   account it belongs to and whether it has **Developer projects**. A key without the permission, a
   key from another account than the connected one, or an account HubSpot or `ALLOWED_PORTALS`
   refuses each get a box that says what to do, with a link to the right account's key page and
   **Check again** / **Try again** (the key and the project stay as they are).
6. A project imported from a file keeps its code paused until they trust it; while HubSpot is
   connected the builder warns that trusted code can read their HubSpot data.
7. **Disconnect** signs them out of HubSpot in the builder.

---

## Troubleshooting

| What you see | What it means | How to fix it |
| --- | --- | --- |
| `/setup.html` says **Almost there**, or the builder says Connect HubSpot **isn't set up** | A setting is missing, too short, or still a placeholder | Step 3. `SESSION_SECRET` needs at least 32 characters. On Vercel, **Redeploy** after changing settings. On Render, wait until the service is **Live** again. |
| `/setup.html` says **no HubSpot connector** | The builder is running as plain files (for example GitHub Pages or `vite preview`) | Use one of the hosts in this guide. Plain file hosting cannot sign in to HubSpot. |
| **Connect HubSpot** is grey and says it is **available on the hosted version** | This copy of the builder has no connector (plain static hosting, a `npm run build:static` build, or `npm run dev:vite`) | Open the builder on an address hosted as described in this guide. Everything else works with mock data. |
| HubSpot shows an error about the **redirect URI / redirect URL** | The address in the HubSpot app does not match exactly | Open `/setup.html` on the address people use, copy the redirect URL and make the app's **Redirect URLs** contain exactly that (`https://`, no extra `/`). If you use your own domain, `APP_URL` must be that domain too. |
| HubSpot says the **scopes** do not match, or the app "requested scopes it is not allowed to" | The scope lists of the app and the connector differ | Use the defaults everywhere, or set `HUBSPOT_SCOPES` / `HUBSPOT_OPTIONAL_SCOPES` to exactly the app's required / optional scopes. |
| The builder says a **permission is missing** (e.g. tickets, custom objects) | That account did not grant an optional permission, or its HubSpot plan has no such data | Click **Disconnect**, then **Connect HubSpot** again and approve all permissions. Some objects (custom objects, quotes) need a paid HubSpot plan. |
| The person sees a HubSpot message about **not being allowed to install apps** | Only Super Admins or users with App Marketplace access can install apps | A Super Admin connects once (installs the app for the account) or grants **App Marketplace access** in HubSpot **Settings → Users & Teams**. |
| **EU accounts**: the HubSpot window keeps loading, or says the account cannot be found | The account is hosted in HubSpot's EU data centre | Add the setting `HUBSPOT_APP_BASE` = `https://app-eu1.hubspot.com` and redeploy. |
| Connect works, but the builder immediately shows **not connected** again | The browser is not keeping the builder's cookie | Allow cookies for the builder's address (strict privacy settings or extensions can block them). Use the exact address in `APP_URL`, over `https://`. On Vercel, use the production address, not a preview address. |
| **This website is not allowed to use the HubSpot connector** | The builder was opened on a different address than `APP_URL` | Open the builder on its `APP_URL` address, or add the other address to `ALLOWED_ORIGINS`. |
| The HubSpot window does not open | The browser blocked the pop-up | The builder offers **Continue in this tab**. Or allow pop-ups for the builder's address and click **Connect HubSpot** again. |
| HubSpot says the app **could not be installed because the app developer has not signed the acceptable use policy** | The HubSpot account that owns the app has not accepted HubSpot's Acceptable Use Policy yet | Step 2 → [Accept HubSpot's Acceptable Use Policy](#accept-hubspots-acceptable-use-policy-once): **Development → Projects → your project → app → Distribution → Begin publishing**, then sign. No Marketplace listing is needed. |
| Your logs show sign-ins that start (`GET /api/auth/start`) but never come back (`/api/auth/callback`), and people say "it just closed" | HubSpot showed a message inside its window instead of connecting: usually the Acceptable Use Policy (row above), or the person may not install apps (Super Admin needed), or the pop-up was blocked | Sign the policy first - it is the most common cause. Ask the person what the builder's **What did HubSpot show?** box says; its notes tell you what they saw. |
| HubSpot says the app has reached its **install limit** | An app without a Marketplace listing can be installed in up to **25** HubSpot accounts | Uninstall it from accounts that no longer use it (**Settings → Integrations → Connected apps**), or publish a Marketplace listing. `ALLOWED_PORTALS` keeps strangers from using up installs. |
| The first visit is very slow (Render) | The free plan sleeps after 15 minutes | Choose the **Starter** plan, or wait up to a minute. |
| **Publish to HubSpot** says the key is not valid | Wrong, deleted, or another account's personal access key | Create a new key in the account you are deploying to and paste it again. |
| **Publish to HubSpot** says the key *looks like a private app access token* | A `pat-…` token from a private app was pasted | Open the **Personal access key** page (not Private apps) and copy that key - a much longer code. |
| **Publish to HubSpot** says *This key can't publish yet: it's missing the "Developer projects" permission* | The key was created without it (the builder reads the key's permissions from HubSpot before uploading). Seen in real logs as `POST /api/deploy` refused with **403** again and again | Click **Open the key page for …** in that box, add **Developer projects** to the key (or create a new one with it), then **Check again** (or paste the new key). |
| **Publish to HubSpot** says *This key is for a different HubSpot account* | The key belongs to another account than the one you're connected to | Use the box's link to the connected account's key page and paste that key, or **Switch HubSpot account** to the key's account. |
| **Publish to HubSpot** says *HubSpot refused to take the project* (with HubSpot's words) | HubSpot answered 403 for another reason - usually the key's user may not use developer tools in that account | A Super Admin allows it (**Settings → Users & Teams** → the user's permissions) or publishes with their own key. The box has a note to send them. |
| **Publish to HubSpot** says *HubSpot doesn't allow developer projects in this account* | The account has no access to developer projects | Publish to an account that shows **Development** in HubSpot's main menu (a developer test account works). |
| **Publish to HubSpot** says *This builder doesn't publish to account …* | `ALLOWED_PORTALS` doesn't list that account | Add the account id to `ALLOWED_PORTALS` and redeploy (the person can copy you a note with the id). |
| The **Publish to HubSpot** tab says it **needs one more server setting (SESSION_SECRET)** | `SESSION_SECRET` is missing, too short or still `later` | Make one at `/secret.html`, add it to your host's settings and redeploy (Step 1 → Vercel → step 6). |
| The **Publish to HubSpot** tab says deploying **is turned off** | `ENABLE_DEPLOY=false` is set | Remove the setting (or set it to `true`) and redeploy, or use the HubSpot CLI. |
| **Publish to HubSpot** asks to **Connect HubSpot first** | Sign-in is set up, and deploys only go to the connected account | Click **Connect HubSpot**, then deploy. To deploy to another account, use **Switch account**. |
| **This deploy can't be followed any more** | The status link expired (after an hour) or was opened in another browser | Open the project in HubSpot to see how it went, or deploy again. |
| HubSpot window says **This HubSpot account can't be used here** | `ALLOWED_PORTALS` doesn't list that account | Add the account id to `ALLOWED_PORTALS` and redeploy, or connect a listed account. |
| The builder says **Your browser blocked the HubSpot window** | A pop-up blocker stopped the sign-in window | Click **Continue in this tab** (signs in in the same tab and comes back), or allow pop-ups for the builder's address. |
| **Too many sign-in attempts** / **Too many deploys** | The server limits how often these can happen | Wait a minute and try again. |
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
  builder's own address (`APP_URL`, plus any `ALLOWED_ORIGINS`), which blocks other websites. The
  cookies use the `__Host-` prefix on `https://`, so other sites on your domain can't plant or
  replace them.
- **Who can connect.** Any account that installs your app, unless you set `ALLOWED_PORTALS` (the
  recommended setting). Sign-in, deploys and the fetch proxy are rate limited.
- **Signing out** revokes the sign-in at HubSpot. The builder re-checks it with HubSpot every few
  minutes and before every deploy, so even a copied cookie stops working within about five
  minutes. To sign *everyone* out at once, change `SESSION_SECRET`.
- **Personal access keys** (Deploy to HubSpot) are used for that one deploy and **never stored** -
  not in a cookie, not on the server. Once sign-in is set up, deploying needs a HubSpot sign-in and
  the key must belong to that same account. A running deploy can only be followed from the browser
  that started it (its status token is tied to that browser and never appears in server logs).
- **Imported projects.** A `.uiex.json` someone sends you can contain code. It stays paused until
  you choose **Trust**; while HubSpot is connected the builder tells you plainly that trusted code
  could read your HubSpot data, and a project trusted before you connected is asked about again.
  Only trust files from people you trust.
- **Preview fetch proxy.** Cards that call outside APIs (`hubspot.fetch`) can be previewed through
  the connector (signed-in people only). It refuses private and internal network addresses: host
  names are checked everywhere, and on the Node server (Render, Docker, any Node host) every
  address a name resolves to is checked too, and the connection goes only to a checked address (so
  names like `127.0.0.1.nip.io` or DNS tricks can't reach your network). Vercel and Cloudflare have
  no private network to reach. In local development, `http://localhost` backends can be previewed
  only from a browser on the same computer. Turn the proxy off with `ENABLE_FETCH_PROXY=false` if
  you don't need it.
- **Secrets.** Keep `HUBSPOT_CLIENT_SECRET` and `SESSION_SECRET` only in your host's settings.
  The server never prints them. Changing `SESSION_SECRET` signs everyone out (they just connect
  again). If the client secret leaks, rotate it in the HubSpot app's **Auth** tab and update
  `HUBSPOT_CLIENT_SECRET`.

**How to remove access**

- One person: click **Disconnect** in the builder.
- A whole HubSpot account: in HubSpot, click the **settings** (gear) icon → **Integrations** →
  **Connected apps** → **UI Extension Builder** → **Actions** → **Uninstall**. This revokes every
  token for that account.
- Everyone, everywhere: change `SESSION_SECRET` (signs everyone out - it is the only way to make
  every existing sign-in cookie invalid at once) and remove or rotate the app's client secret in
  HubSpot.

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
| `ALLOWED_PORTALS` | recommended | - (any account) | HubSpot account ids that may sign in and deploy, comma separated |
| `TRUST_PROXY` | no | `true` | Node server: read the client address from `X-Forwarded-For` (behind Render's or your own proxy). Set `false` when the server is reached directly |
| `PORT` | no | `3000` | Port for `npm start` / Docker |
| `LOG_REQUESTS` | no | `true` | Log one line per API request (paths only - deploy status tokens are replaced by `…` - never data or secrets) |

Placeholder values such as `later`, `todo` or `-` count as "not set".

---

## For developers: run it on your computer

| Command | What it does |
| --- | --- |
| `npm run dev` | Builder on http://localhost:5173 (this computer only; `npm run dev -- --host` opens it to your network) plus the connector. Without settings, Connect HubSpot shows as not set up - everything else works. To sign in to a real account, create a **separate development app** with the redirect URL `http://localhost:5173/api/auth/callback` (never add localhost to the app people use) and put its settings in `.env.local` (see `.env.example`). |
| `npm run dev:full` | Same, plus a **fake HubSpot** with demo data on port 4010: try the whole Connect flow, sample records and Deploy to HubSpot without a HubSpot account. The demo personal access key is on the fake's personal access key page (Publish → Publish to HubSpot → **Open HubSpot’s key page**) and printed in the terminal. The fake can also play HubSpot saying no: its consent page links to the install refusals (Acceptable Use Policy, no permission, install limit), and its key page removes / adds back the key's **Developer projects** permission. |
| `npm run build` then `npm start` | Production server on http://localhost:3000 |
| `npm run start:demo` | Production build + fake HubSpot on http://localhost:4174 (used for demos and end-to-end tests; run `npm run build` first) |
| `npm run secret` | Print a new `SESSION_SECRET` |
| `npm run build:static` | The builder alone for plain static hosting (Connect HubSpot shows "available on the hosted version"; nothing calls `/api`) |
| `npm run e2e:connect` | End-to-end tests of the whole Connect flow, live data and Deploy to HubSpot against the fake HubSpot (`CONNECT_SCREENSHOTS=<dir>` also saves screenshots) |

Code: the connector core is in `server/core` (standard Web `Request`/`Response`, no framework). The
hosting adapters are thin: `server/node.ts` (Node, Render, Docker), `api/[...path].ts` (Vercel),
`server/cloudflare.ts` (Cloudflare Workers).
