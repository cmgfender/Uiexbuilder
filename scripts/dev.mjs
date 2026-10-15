#!/usr/bin/env node
/**
 * Local development launcher.
 *
 *   npm run dev        Vite (http://localhost:5173) + the HubSpot connector API on :3001 (Vite
 *                      proxies /api to it). Without HubSpot settings the connector reports
 *                      "not configured" and the builder shows Connect as unavailable with a hint.
 *                      Put real settings in .env.local (see .env.example) to sign in to a real portal.
 *   npm run dev:full   Same, plus a FAKE HubSpot on :4010 with demo data, so anyone can try the
 *                      whole Connect flow (consent page, real-looking records, deploy) offline.
 *   npm run start:demo Production server (built dist/) + fake HubSpot on http://localhost:4174 —
 *                      what end-to-end tests and demos use. Run "npm run build" first.
 *
 * Server code is bundled with esbuild (already a dependency) and restarted on change.
 * Env: UIEX_VITE_PORT (5173), UIEX_API_PORT (3001), FAKE_HUBSPOT_PORT (4010), UIEX_DEMO_PORT (4174).
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, watchServer, buildServer } from './build-server.mjs';

const args = process.argv.slice(2);
const FAKE = args.includes('--fake');
const PROD = args.includes('--prod');
const passThrough = args.filter((a) => a !== '--fake' && a !== '--prod');

const API_PORT = Number(process.env.UIEX_API_PORT || 3001);
const FAKE_PORT = Number(process.env.FAKE_HUBSPOT_PORT || 4010);
const DEMO_PORT = Number(process.env.UIEX_DEMO_PORT || 4174);
const VITE_PORT = Number(process.env.UIEX_VITE_PORT || 5173);
const VITE_URL = `http://localhost:${VITE_PORT}`;
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'uiex-dev');
const DEMO_CLIENT_ID = 'uiex-demo-client-id';
const DEMO_CLIENT_SECRET = 'uiex-demo-client-secret';

const say = (msg) => console.log(`\x1b[36m[uiex]\x1b[0m ${msg}`);
const warn = (msg) => console.warn(`\x1b[33m[uiex]\x1b[0m ${msg}`);

/** Minimal .env parser (KEY=value, # comments, optional quotes). Real env vars win. */
function loadEnvFiles() {
  const out = {};
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let value = m[2];
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '');
      out[m[1]] = value;
    }
  }
  return out;
}

/** A per-checkout session secret, kept across restarts so you stay signed in while editing server code. */
function devSessionSecret() {
  const file = path.join(CACHE_DIR, 'session-secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // first run
  }
  const secret = randomBytes(36).toString('base64url'); // 48 characters
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function fileHash(file) {
  try {
    return createHash('sha1').update(readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

/** A restartable child process. */
function managed(label, makeCommand) {
  let child = null;
  let stopping = false;
  return {
    start() {
      const { command, argv, env } = makeCommand();
      child = spawn(command, argv, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
      const self = child;
      child.on('exit', (code, signal) => {
        if (self !== child || stopping) return;
        child = null;
        if (code !== 0 && signal === null) warn(`${label} stopped (exit code ${code}).${PROD ? '' : ' It restarts when you save a change.'}`);
      });
    },
    async stop() {
      if (!child) return;
      const c = child;
      child = null;
      await new Promise((resolve) => {
        c.once('exit', resolve);
        c.kill('SIGTERM');
        setTimeout(() => {
          c.kill('SIGKILL');
          resolve();
        }, 3000).unref();
      });
    },
    async restart() {
      await this.stop();
      this.start();
    },
    shutdown() {
      stopping = true;
      return this.stop();
    },
  };
}

function apiEnv(fileEnv, fakeUrl) {
  const env = {
    NODE_ENV: 'development',
    LOG_REQUESTS: process.env.LOG_REQUESTS ?? '1',
    SESSION_SECRET: fileEnv.SESSION_SECRET || process.env.SESSION_SECRET || devSessionSecret(),
  };
  if (fakeUrl) {
    Object.assign(env, {
      HUBSPOT_CLIENT_ID: DEMO_CLIENT_ID,
      HUBSPOT_CLIENT_SECRET: DEMO_CLIENT_SECRET,
      // The browser opens the consent page via localhost; the connector calls the API on 127.0.0.1.
      HUBSPOT_APP_BASE: fakeUrl.replace('127.0.0.1', 'localhost'),
      HUBSPOT_API_BASE: fakeUrl,
    });
  } else {
    for (const key of [
      'HUBSPOT_CLIENT_ID',
      'HUBSPOT_CLIENT_SECRET',
      'HUBSPOT_SCOPES',
      'HUBSPOT_OPTIONAL_SCOPES',
      'HUBSPOT_API_BASE',
      'HUBSPOT_APP_BASE',
      'ENABLE_FETCH_PROXY',
      'ENABLE_DEPLOY',
      'ALLOWED_ORIGINS',
    ]) {
      if (fileEnv[key] !== undefined && process.env[key] === undefined) env[key] = fileEnv[key];
    }
  }
  return env;
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const fileEnv = FAKE ? {} : loadEnvFiles();
  const fakeUrl = FAKE || PROD ? `http://127.0.0.1:${FAKE_PORT}` : null;
  const nodeBundle = path.join(CACHE_DIR, 'node.mjs');
  const fakeBundle = path.join(CACHE_DIR, 'fake-hubspot.mjs');

  const fake = managed('Fake HubSpot', () => ({
    command: process.execPath,
    argv: ['--enable-source-maps', fakeBundle],
    env: { FAKE_HUBSPOT_PORT: String(FAKE_PORT), FAKE_HUBSPOT_CLIENT_ID: DEMO_CLIENT_ID, FAKE_HUBSPOT_CLIENT_SECRET: DEMO_CLIENT_SECRET },
  }));

  // ---- start:demo: production server + fake HubSpot ----------------------------------------
  if (PROD) {
    // Playwright may start this while "npm run build" is still running: wait for dist/ (5 min max).
    const index = path.join(ROOT, 'dist', 'index.html');
    if (!existsSync(index)) {
      say('Waiting for the builder build (dist/). Run "npm run build" if nothing is building it.');
      const deadline = Date.now() + 5 * 60_000;
      while (!existsSync(index)) {
        if (Date.now() > deadline) {
          warn('The builder has not been built. Run "npm run build" first.');
          process.exit(1);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    await buildServer({ outdir: CACHE_DIR });
    const appUrl = `http://localhost:${DEMO_PORT}`;
    const server = managed('Server', () => ({
      command: process.execPath,
      argv: ['--enable-source-maps', nodeBundle, '--port', String(DEMO_PORT)],
      env: { ...apiEnv({}, fakeUrl), APP_URL: appUrl },
    }));
    fake.start();
    server.start();
    say(`Demo with fake HubSpot data: ${appUrl}`);
    const stopAll = async () => {
      await Promise.all([server.shutdown(), fake.shutdown()]);
      process.exit(0);
    };
    process.on('SIGINT', stopAll);
    process.on('SIGTERM', stopAll);
    return;
  }

  // ---- dev / dev:full: API (+ fake) with rebuild-on-change, plus Vite ------------------------
  const api = managed('Connector API', () => ({
    command: process.execPath,
    argv: ['--enable-source-maps', nodeBundle, '--api-only', '--port', String(API_PORT), '--host', '127.0.0.1'],
    env: { ...apiEnv(fileEnv, fakeUrl), APP_URL: VITE_URL },
  }));

  const hashes = new Map();
  let ready = false;
  let disposeWatch = null;
  try {
    disposeWatch = await watchServer({
      outdir: CACHE_DIR,
      names: FAKE ? ['node', 'fake-hubspot'] : ['node'],
      onRebuild: (name, ok) => {
        if (!ok) {
          warn(`Server code has errors (${name}); keeping the last working version running.`);
          return;
        }
        const file = name === 'node' ? nodeBundle : fakeBundle;
        const hash = fileHash(file);
        if (hashes.get(name) === hash) return;
        hashes.set(name, hash);
        if (!ready) return; // the first build starts everything below
        say(`${name === 'node' ? 'Connector API' : 'Fake HubSpot'} changed - restarting.`);
        void (name === 'node' ? api : fake).restart();
      },
    });
  } catch (err) {
    warn(`Could not build the connector (${err?.message ?? err}). The builder still runs; Connect HubSpot will be unavailable.`);
  }
  ready = true;
  if (FAKE && existsSync(fakeBundle)) fake.start();
  if (existsSync(nodeBundle)) api.start();

  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const configured = FAKE || !!(fileEnv.HUBSPOT_CLIENT_ID || process.env.HUBSPOT_CLIENT_ID);
  // Sign-in redirects back to APP_URL, so Vite must not silently move to another port.
  const viteArgs = ['--port', String(VITE_PORT), ...(configured ? ['--strictPort'] : []), ...passThrough];
  const vite = spawn(process.execPath, [viteBin, ...viteArgs], {
    cwd: ROOT,
    env: { ...process.env, UIEX_API_PORT: String(API_PORT) },
    stdio: 'inherit',
  });

  if (FAKE) {
    say(`Fake HubSpot on ${fakeUrl} - click "Connect HubSpot" in the builder and approve the demo consent page.`);
  } else if (!configured) {
    say('HubSpot sign-in is not configured (that is fine). Use "npm run dev:full" to try it with demo data,');
    say('or copy .env.example to .env.local and add your HubSpot app settings.');
  }

  let shuttingDown = false;
  const stopAll = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    vite.kill('SIGTERM');
    await Promise.all([api.shutdown(), fake.shutdown(), disposeWatch?.()]);
    process.exit(code);
  };
  vite.on('exit', (code) => void stopAll(code ?? 0));
  process.on('SIGINT', () => void stopAll(0));
  process.on('SIGTERM', () => void stopAll(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
