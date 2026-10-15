/**
 * The small self-contained HTML page shown in the sign-in popup after HubSpot redirects back.
 * It tells the builder the result and closes itself:
 *   window.opener.postMessage({ type: 'uiex-hubspot-auth', ok, error?, message? }, <validated origin>)
 * and, as a fallback for browsers that cut the opener link during the HubSpot login (COOP), it also
 * broadcasts the same message on BroadcastChannel('uiex-hubspot-auth') (same-origin only).
 *
 * No external resources. CSP: default-src 'none' with the inline script and style allowed by hash.
 */
import { escapeHtml, scriptSafeJson } from './http';
import { sha256Base64 } from './crypto';

export const AUTH_MESSAGE_TYPE = 'uiex-hubspot-auth';
export const AUTH_BROADCAST_CHANNEL = 'uiex-hubspot-auth';

export interface AuthResultMessage {
  type: typeof AUTH_MESSAGE_TYPE;
  ok: boolean;
  /** Machine code on failure, e.g. 'access_denied', 'state_mismatch', 'not_configured'. */
  error?: string;
  /** Plain-language explanation on failure. */
  message?: string;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f5f8fa;--card:#fff;--text:#33475b;--muted:#516f90;--accent:#ff7a59;--ok:#00a38d;--err:#d93f4c;--border:#cbd6e2}
@media (prefers-color-scheme:dark){:root{--bg:#1d2733;--card:#26323f;--text:#eaf0f6;--muted:#b0c1d4;--border:#3e5165}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:16px}
main{background:var(--card);border:1px solid var(--border);border-radius:8px;max-width:440px;width:100%;padding:28px 24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}
p{margin:0 0 16px;color:var(--muted)}
.icon{font-size:32px;line-height:1;margin-bottom:12px}
.ok .icon{color:var(--ok)}
.err .icon{color:var(--err)}
.actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
button,a.button{appearance:none;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:4px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
a.button.secondary{background:transparent;color:var(--text);border-color:var(--border)}
button:focus-visible,a.button:focus-visible{outline:3px solid #0091ae;outline-offset:2px}
`.trim();

export interface AuthPageOptions {
  status: number;
  ok: boolean;
  title: string;
  message: string;
  /** postMessage target origin; null when unknown (then nothing is posted to the opener). */
  targetOrigin: string | null;
  /** "Back to the builder" link (validated). */
  returnTo: string | null;
  errorCode?: string;
}

export async function renderAuthPage(opts: AuthPageOptions): Promise<Response> {
  const msg: AuthResultMessage = { type: AUTH_MESSAGE_TYPE, ok: opts.ok };
  if (!opts.ok) {
    msg.error = opts.errorCode ?? 'unknown_error';
    msg.message = opts.message;
  }
  const script = `(function(){var m=${scriptSafeJson(msg)};var o=${scriptSafeJson(opts.targetOrigin)};var sent=false;try{if(o&&window.opener&&!window.opener.closed){window.opener.postMessage(m,o);sent=true}}catch(e){}try{if(typeof BroadcastChannel==="function"){var c=new BroadcastChannel(${scriptSafeJson(AUTH_BROADCAST_CHANNEL)});c.postMessage(m);c.close();sent=true}}catch(e){}var b=document.getElementById("close");if(b){b.addEventListener("click",function(){window.close()})}if(m.ok&&sent){setTimeout(function(){window.close()},150)}})();`;
  const [scriptHash, styleHash] = await Promise.all([sha256Base64(script), sha256Base64(STYLE)]);
  const back = opts.returnTo
    ? `<a class="button secondary" href="${escapeHtml(opts.returnTo)}">Back to the builder</a>`
    : '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(opts.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="${opts.ok ? 'ok' : 'err'}" role="main" aria-live="polite">
<div class="icon" aria-hidden="true">${opts.ok ? '&#10003;' : '&#9888;'}</div>
<h1>${escapeHtml(opts.title)}</h1>
<p>${escapeHtml(opts.message)}</p>
<div class="actions"><button type="button" id="close">Close this window</button>${back}</div>
</main>
<script>${script}</script>
</body>
</html>`;
  return new Response(html, {
    status: opts.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}

/** Plain-language explanations for OAuth error codes HubSpot (or the connector) can produce. */
export function describeAuthError(code: string): { title: string; message: string } {
  switch (code) {
    case 'access_denied':
      return { title: 'HubSpot was not connected', message: 'You chose not to give the builder access. Nothing was shared. You can close this window and try again whenever you like.' };
    case 'state_mismatch':
    case 'state_missing':
      return {
        title: 'Sign-in expired',
        message: 'This sign-in took too long or was started in another window. Close this window and click “Connect HubSpot” again.',
      };
    case 'invalid_scope':
      return { title: 'HubSpot refused the requested access', message: "The builder asked for permissions this HubSpot app isn't set up for. Ask whoever hosts the builder to check the app's scopes." };
    case 'token_exchange_failed':
      return { title: "Couldn't finish connecting", message: "HubSpot didn't accept the sign-in. Close this window and try again. If it keeps happening, ask whoever hosts the builder to check the app settings." };
    case 'hubspot_unreachable':
      return { title: "Couldn't reach HubSpot", message: 'HubSpot did not respond. Check your internet connection, close this window and try again.' };
    case 'not_configured':
      return { title: 'Sign in with HubSpot is not set up', message: "This server isn't configured for HubSpot sign-in yet." };
    case 'bad_return_to':
      return { title: 'This sign-in link is not valid', message: 'Open the builder and click “Connect HubSpot” from there.' };
    default:
      return { title: "Couldn't connect HubSpot", message: 'Something went wrong while connecting. Close this window and try again.' };
  }
}
