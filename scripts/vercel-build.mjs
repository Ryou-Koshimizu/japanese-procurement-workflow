// Vercel build: run the whole app as ONE Node server inside one function.
// The public demo keeps its data in a shared PostgreSQL (DEMO_DATABASE_URL,
// see src/server/demo-postgres.ts); one function means one copy of the
// runtime per instance, one connection pool, and the bundled demo supplier
// site and schema next to the server.
// Uses the Build Output API v3 (https://vercel.com/docs/build-output-api/v3).
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

execFileSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_OUTPUT: 'standalone' },
});

const out = '.vercel/output';
const fn = join(out, 'functions/index.func');
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

// Next links its external packages with relative symlinks. Copying would turn
// them into absolute links to the build machine, so replace each with a copy
// of its target.
function copyResolvingLinks(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const stat = lstatSync(from);
    if (stat.isSymbolicLink())
      cpSync(realpathSync(from), to, { recursive: true, dereference: true });
    else if (stat.isDirectory()) copyResolvingLinks(from, to);
    else cpSync(from, to);
  }
}
copyResolvingLinks('.next/standalone', fn);
cpSync('.next/static', join(fn, '.next/static'), { recursive: true });
cpSync('.next/static', join(out, 'static/_next/static'), { recursive: true });
if (existsSync('public')) {
  cpSync('public', join(fn, 'public'), { recursive: true });
  cpSync('public', join(out, 'static'), { recursive: true });
}
cpSync('scripts/vercel-handler.mjs', join(fn, 'vercel-handler.mjs'));

writeFileSync(
  join(fn, '.vc-config.json'),
  JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'vercel-handler.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    maxDuration: 120,
  }),
);
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify({
    version: 3,
    routes: [
      {
        src: '^/_next/static/(.*)$',
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
        continue: true,
      },
      { handle: 'filesystem' },
      { src: '^/(.*)$', dest: '/index' },
    ],
  }),
);
console.log('Vercel output: one function for every page and API route.');
