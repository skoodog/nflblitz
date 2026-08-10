#!/usr/bin/env node
// Bundle the built game into ONE self-contained HTML file.
//
// The dev server is not reachable from outside this container, so the only way to put the
// game in front of a person is to inline it: `npx vite build` produces exactly two files
// (index.html and one ~1.6 MB module), and this folds them into a single page that can be
// published as an artifact and opened on a phone.
//
// TWO THINGS HERE ARE LOAD-BEARING AND BOTH FAIL SILENTLY IF DROPPED:
//
//   1. `</script` appearing anywhere inside the bundle -- in a GLSL string, a regex, an
//      HTML snippet -- terminates the inline tag early and the page dies with no error.
//      Every occurrence is escaped. The count is printed so a future reader knows whether
//      the guard is doing anything.
//   2. The artifact wrapper owns <head>, so the viewport meta cannot be written into the
//      markup. Without it a phone renders the stage at desktop width and pinch-zoom stays
//      live, which breaks the thumbstick. It is installed at runtime instead.
//
//   node tools/build-playable.mjs [out.html]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(ROOT, 'dist');
if (!fs.existsSync(dist)) {
  console.error('no dist/ — run `npx vite build` first');
  process.exit(1);
}
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const jsName = fs.readdirSync(path.join(dist, 'assets')).find((f) => /^main-.*\.js$/.test(f));
let js = fs.readFileSync(path.join(dist, 'assets', jsName), 'utf8');
const guarded = js.split('</script').length - 1;
js = js.split('</script').join('<\\/script');
const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];

const out = process.argv[2] || path.join(ROOT, 'dist', 'playable.html');
const tpl = fs.readFileSync(path.join(ROOT, 'tools', 'playable-shell.html'), 'utf8');
fs.writeFileSync(out, tpl.replace('/*STYLE*/', style).replace('/*BUNDLE*/', js));
console.log(`wrote ${out}  ${(fs.statSync(out).size / 1048576).toFixed(2)} MB`);
console.log(`escaped ${guarded} occurrence(s) of </script inside the bundle`);
