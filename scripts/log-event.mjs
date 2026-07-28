#!/usr/bin/env node
// FOUNDATION — FROZEN after t=0. Do not edit.
//
// Append-only, race-free event log. 16 concurrent agents can call this without
// corrupting the file: one O_APPEND write of one line, which POSIX guarantees is
// atomic for writes below PIPE_BUF-ish sizes and, on a regular file with O_APPEND,
// never interleaves at the wrong offset.
//
//   node scripts/log-event.mjs --piece=turf-field --round=2 --agent=critic \
//        --event=verdict --score=72 --gap="turf reads flat; no wet specular" \
//        --shot=shots/turf-field/truck.png --cmp=shots/turf-field/cmp.png
//
// event kinds: start | build_done | shot | verdict | gap | fixed | note
//              | round_open | round_close

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const LOG = path.join(REPO, 'progress', 'events.jsonl');

const KINDS = new Set(['start', 'build_done', 'shot', 'verdict', 'gap', 'fixed', 'note', 'round_open', 'round_close']);

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    if (i < 0) out[a.slice(2)] = true;
    else out[a.slice(2, i)] = a.slice(i + 1);
  }
  return out;
}

const a = parseArgs(process.argv.slice(2));

if (a.help || (!a.event && !a.piece)) {
  console.log(`usage: node scripts/log-event.mjs --piece=<id> --round=<n> --agent=builder|critic|lead
       --event=${[...KINDS].join('|')} [--score=0-100] [--gap="..."] [--text="..."]
       [--shot=path] [--cmp=path] [--ms=n]`);
  process.exit(a.help ? 0 : 2);
}

const event = String(a.event || 'note');
if (!KINDS.has(event)) {
  console.error(`unknown --event "${event}". Use one of: ${[...KINDS].join(', ')}`);
  process.exit(2);
}

const rec = {
  ts: new Date().toISOString(),
  round: a.round !== undefined ? Number(a.round) : 0,
  piece: a.piece ? String(a.piece) : null,
  agent: a.agent ? String(a.agent) : 'builder',
  event,
};
if (a.shot !== undefined) rec.shot = String(a.shot);
if (a.cmp !== undefined) rec.cmp = String(a.cmp);
if (a.score !== undefined) rec.score = Number(a.score);
if (a.gap !== undefined) rec.gap = String(a.gap);
if (a.text !== undefined) rec.text = String(a.text);
if (a.note !== undefined) rec.text = String(a.note);
if (a.ms !== undefined) rec.ms = Number(a.ms);

fs.mkdirSync(path.dirname(LOG), { recursive: true });
const fd = fs.openSync(LOG, 'a');
try {
  fs.writeSync(fd, JSON.stringify(rec) + '\n');
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
console.log(JSON.stringify(rec));
