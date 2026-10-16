# UI Extension Builder - HubSpot sign-in app

This folder is a ready-made **HubSpot developer project** (platform `2026.03`). Uploading it once
creates the HubSpot app that powers **Connect HubSpot** in UI Extension Builder. You do not change
any code here - only one address.

What the app does: it lets people who use your builder sign in with HubSpot so the builder can
**read** their CRM records, properties, pipelines and owners for previews. It cannot change data:
every scope it asks for is a `.read` scope (plus `oauth`, which HubSpot requires for sign-in).

## Before you upload: put in your builder's address

Open `src/app/app-hsmeta.json` and replace `YOUR-DOMAIN` with your builder's address, for example:

```json
"redirectUrls": [
  "https://builder.example.com/api/auth/callback",
  "http://localhost:5173/api/auth/callback"
],
```

- The first line must match your builder exactly (`https://`, no trailing slash before `/api`).
- The `localhost` line is only for developers running the builder on their own computer; you
  can delete it.
- Optionally replace the `support` details (shown on HubSpot's consent screen) with your own.

## Upload it (choose one)

**A. No terminal** - open `https://<your builder>/setup.html`, click **Download the app file**
(it is this app, already filled in with your address), import it in the builder and click
**Deploy to HubSpot** (beta). Exact clicks:
[docs/HOSTING.md, step 2, option A](../docs/HOSTING.md#option-a-no-terminal-from-the-builder-itself).
The file is generated from this folder by `node scripts/make-connector-app.mjs`.

**B. HubSpot CLI** (one time, any computer with Node.js 20+):

```bash
npm install -g @hubspot/cli
hs account auth          # sign in to the HubSpot account that should own the app
cd hubspot-app
hs project upload
```

Then in HubSpot: **Development → Projects → uiex-builder-connector → UI Extension Builder →
Auth** - copy the **Client ID** and **Client secret** into your host's settings
(`HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`).

## Who can sign in?

`"distribution": "marketplace"` (the default here) means **any HubSpot account can connect** by
signing in from your builder. The app is *not* listed on the HubSpot Marketplace - nobody finds it
unless they use your builder.

Prefer to restrict it to your own accounts? Change it to `"distribution": "private"` before the
first upload (decide up front - HubSpot may not let you switch an uploaded app). A private OAuth app can only be installed in the
HubSpot accounts you add to its allowlist: **Development → Projects → your app → Distribution →
Add account**. People from other accounts then see an error when they try to connect.

## Scopes

| Required | Why |
| --- | --- |
| `oauth` | Needed for every sign-in |
| `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read` | Pick sample records and show their real values |
| `crm.schemas.contacts.read`, `crm.schemas.companies.read`, `crm.schemas.deals.read` | Real property names, labels and dropdown options in pickers |

| Optional (asked for, can be declined) | Why |
| --- | --- |
| `crm.objects.tickets.read` | Ticket records |
| `crm.schemas.tickets.read` | Ticket properties and pipelines |
| `crm.objects.custom.read`, `crm.schemas.custom.read` | Custom objects |
| `crm.objects.owners.read` | Record owners |
| `crm.objects.line_items.read`, `crm.objects.products.read`, `crm.objects.quotes.read` | Line items, products and quotes |

These match the connector's defaults. If you change them here, set the same lists in the
`HUBSPOT_SCOPES` / `HUBSPOT_OPTIONAL_SCOPES` settings of your builder, or sign-in fails with a
"scope mismatch" error.
