import fs from 'node:fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

// usage: node _crit2.mjs out.png barX,barY,barW,barH ourX,ourY,ourW,ourH [ourPng]
const b64 = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const BAR = b64('/home/user/nflblitz/bar/panel-title.png');
const OUT = process.argv[2];
const A = process.argv[3].split(',').map(Number);
const B = process.argv[4].split(',').map(Number);
const OURS = b64(process.argv[5] || '/home/user/nflblitz/shots/menu-title/crit-title.png');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
await page.setContent('<body style="margin:0;background:#111"><canvas id=cv></canvas></body>');
await page.evaluate(async ([barSrc, ourSrc, a, b]) => {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
  const bar = await load(barSrc), our = await load(ourSrc);
  const W = 1600;
  function crop(im, f) {
    const sx = f[0] * im.naturalWidth, sy = f[1] * im.naturalHeight;
    const sw = f[2] * im.naturalWidth, sh = f[3] * im.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = Math.round(W * sh / sw);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  const ca = crop(bar, a), cb = crop(our, b);
  const cv = document.getElementById('cv');
  cv.width = W; cv.height = ca.height + cb.height + 12;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(ca, 0, 0); c.drawImage(cb, 0, ca.height + 12);
  c.font = 'bold 24px monospace'; c.fillStyle = '#ffd000';
  c.fillText('BAR', 8, 28); c.fillText('OURS', 8, ca.height + 42);
}, [BAR, OURS, A, B]);
await (await page.$('#cv')).screenshot({ path: OUT });
console.log('wrote', OUT);
await browser.close();
