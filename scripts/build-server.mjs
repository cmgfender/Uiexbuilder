#!/usr/bin/env node
/**
 * Bundle the Node server (and the fake HubSpot dev server) with esbuild into self-contained ES
 * modules that need no node_modules at runtime:
 *
 *   dist-server/node.mjs          production server: `npm start` (serves dist/ + /api)
 *   dist-server/fake-hubspot.mjs  fake HubSpot for demos and end-to-end tests
 *
 * Usage: node scripts/build-server.mjs [--outdir dir] [--minify]
 * Also imported by scripts/dev.mjs (watch mode).
 */
import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Entry name → [module, exported function to call]. */
const ENTRIES = {
  node: ['./server/node.ts', 'runCli'],
  'fake-hubspot': ['./server/fake-hubspot/server.ts', 'runFakeHubSpotCli'],
};

function options(name, outdir, { minify = false } = {}) {
  const [modulePath, fn] = ENTRIES[name];
  return {
    // A tiny wrapper entry calls the CLI function explicitly; the modules themselves never
    // auto-start inside a bundle (__UIEX_BUNDLED__), so bundling one into another is safe.
    stdin: {
      contents: `import { ${fn} } from ${JSON.stringify(modulePath)};\n${fn}();\n`,
      resolveDir: ROOT,
      sourcefile: `${name}-entry.ts`,
      loader: 'ts',
    },
    outfile: path.join(outdir, `${name}.mjs`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: true,
    minify,
    legalComments: 'none',
    define: { __UIEX_BUNDLED__: 'true' },
    // Lets bundled CommonJS dependencies (if any) call require() inside an ES module.
    banner: { js: "import { createRequire as __uiexCreateRequire } from 'node:module'; const require = __uiexCreateRequire(import.meta.url);" },
    logLevel: 'warning',
    plugins: name === 'fake-hubspot' ? [skipConnectorCore] : [],
  };
}

/**
 * The fake HubSpot server only uses the HTTP helpers from server/node.ts; leave the connector core
 * (loaded lazily by startServer) out of its bundle so editing the core does not restart the fake
 * (which would forget the demo tokens it issued).
 */
const skipConnectorCore = {
  name: 'uiex-skip-connector-core',
  setup(b) {
    b.onResolve({ filter: /^\.\/core\/index$/ }, (args) =>
      /[\\/]server[\\/]node\.ts$/.test(args.importer) ? { path: args.path, external: true } : undefined,
    );
  },
};

/** One-off build of both bundles. */
export async function buildServer({ outdir = path.join(ROOT, 'dist-server'), minify = false } = {}) {
  await Promise.all(Object.keys(ENTRIES).map((name) => build(options(name, outdir, { minify }))));
  return { outdir, files: Object.keys(ENTRIES).map((name) => path.join(outdir, `${name}.mjs`)) };
}

/**
 * Watch mode for development: rebuilds on change and calls onRebuild(name, ok) after every build.
 * Returns a disposer.
 */
export async function watchServer({ outdir, names = Object.keys(ENTRIES), onRebuild }) {
  const contexts = await Promise.all(
    names.map((name) => {
      const base = options(name, outdir);
      return context({
        ...base,
        plugins: [
          ...base.plugins,
          {
            name: 'uiex-notify',
            setup(b) {
              b.onEnd((result) => onRebuild?.(name, result.errors.length === 0));
            },
          },
        ],
      });
    }),
  );
  // Initial build first (awaited, so callers can start processes right after), then watch.
  await Promise.all(contexts.map((c) => c.rebuild().catch(() => {})));
  await Promise.all(contexts.map((c) => c.watch()));
  return async () => {
    await Promise.all(contexts.map((c) => c.dispose()));
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--outdir');
  const outdir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : undefined;
  const started = Date.now();
  buildServer({ outdir, minify: args.includes('--minify') })
    .then(({ files }) => {
      for (const f of files) console.log(`  built ${path.relative(ROOT, f)}`);
      console.log(`Server bundle ready in ${Date.now() - started} ms. Start it with "npm start".`);
    })
    .catch((err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    });
}
