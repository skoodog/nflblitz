#!/usr/bin/env node
// FOUNDATION — FROZEN after t=0. Do not edit.
// Zero-dependency static server with Range support (the progress page tails
// events.jsonl with byte-range requests).
//
//   node scripts/serve.mjs --dist            docroot ./dist        on 127.0.0.1:5178
//   node scripts/serve.mjs --progress        docroot ./ (repo root) on 127.0.0.1:5179
//   node scripts/serve.mjs --root=<dir> --port=<n>

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function createServer(docroot) {
  const rootAbs = path.resolve(docroot);
  return http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const filePath = path.resolve(rootAbs, '.' + urlPath);
      if (!filePath.startsWith(rootAbs)) { res.writeHead(403).end('forbidden'); return; }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + urlPath);
        return;
      }
      const stat = fs.statSync(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      const baseHeaders = {
        'content-type': type,
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-range,content-length',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };
      if (range && /^bytes=/.test(range)) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
        let end = m && m[2] !== '' ? parseInt(m[2], 10) : stat.size - 1;
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
        if (start >= stat.size) {
          res.writeHead(416, Object.assign({}, baseHeaders, { 'content-range': `bytes */${stat.size}` })).end();
          return;
        }
        res.writeHead(206, Object.assign({}, baseHeaders, {
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'content-length': end - start + 1,
        }));
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, Object.assign({}, baseHeaders, { 'content-length': stat.size }));
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('500 ' + (e && e.message));
    }
  });
}

/** Start and resolve once listening. Returns {server, port, url, close()}. */
export function startServer(docroot, port) {
  return new Promise((resolve, reject) => {
    const server = createServer(docroot);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * Preferred port, falling back to an ephemeral one if it is taken.
 * 16 builder agents may run shoot.mjs / compare.mjs concurrently; without this they
 * would all collide on 5178 / 5179 and every capture but the first would die.
 */
export async function startServerAuto(docroot, preferredPort) {
  try {
    return await startServer(docroot, preferredPort);
  } catch (e) {
    if (e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) {
      const s = await startServer(docroot, 0);
      return s;
    }
    throw e;
  }
}

function arg(name, dflt) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const i = hit.indexOf('=');
  return i < 0 ? true : hit.slice(i + 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const progress = !!arg('progress', false);
  const dist = !!arg('dist', false);
  const root = arg('root', progress ? REPO : dist ? path.join(REPO, 'dist') : REPO);
  const port = Number(arg('port', progress ? 5179 : 5178));
  startServer(root, port).then((s) => {
    console.log(`serving ${root} at ${s.url}`);
    if (progress) console.log(`progress page: ${s.url}/progress/`);
  }).catch((e) => {
    console.error('serve failed:', e.message);
    process.exit(1);
  });
}
