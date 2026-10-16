// The public demo reads the fictional supplier site from disk instead of the
// network: URLs on its reserved example domain map to public/demo-supplier/,
// and every other URL is refused, so the demo cannot be used to make the
// server fetch arbitrary addresses.
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { DEMO_SUPPLIER } from '../demo/supplier-data';
import { FetchError, type Fetcher } from './net';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

let manifest: Map<string, string> | undefined;

/** URL path -> file, built once from the directory listing. */
function files(): Map<string, string> {
  if (manifest) return manifest;
  const root = join(process.cwd(), 'public', 'demo-supplier');
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && TYPES[extname(entry.name)])
        out.set('/' + relative(root, full).split(sep).join('/'), full);
    }
  };
  walk(root);
  manifest = out;
  return out;
}

export const isDemoSupplierUrl = (raw: string) => {
  try {
    return new URL(raw).origin === DEMO_SUPPLIER.origin;
  } catch {
    return false;
  }
};

/** Where the app serves the same page for people to open. */
export function localDemoSupplierUrl(raw: string | null | undefined) {
  if (!raw || !isDemoSupplierUrl(raw)) return raw ?? null;
  const u = new URL(raw);
  return `${DEMO_SUPPLIER.localPath}${u.pathname === '/' ? '/index.html' : u.pathname}`;
}

export function demoSupplierFetcher(): Fetcher {
  return async (raw, options) => {
    if (!isDemoSupplierUrl(raw))
      throw new FetchError(
        '公開デモでは、同梱の架空の仕入先サイト（sakura-supply.example）だけを読み込めます',
        'blocked',
      );
    const url = new URL(raw);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = files().get(decodeURIComponent(path));
    if (!file) throw new FetchError('サーバーが 404 を返しました', 'http', 404);
    const body = readFileSync(file);
    if (body.length > options.maxBytes)
      throw new FetchError('大きすぎるため読み込みませんでした', 'too_large');
    return {
      url: url.href,
      status: 200,
      contentType: TYPES[extname(file)],
      body,
    };
  };
}
