import fs from 'node:fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const b64 = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const BAR = b64('/home/user/nflblitz/bar/panel-title.png');
const OURS = b64(process.argv[2] || '/home/user/nflblitz/shots/menu-title/crit-title.png');
const OUT = process.argv[3] || '/home/user/nflblitz/shots/menu-title/crit-crop.png';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
await page.setContent('<body style="margin:0;background:#111"><canvas id=cv></canvas></body>');

const res = await page.evaluate(async ([barSrc, ourSrc]) => {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
  const bar = await load(barSrc), our = await load(ourSrc);
  function px(im) {
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    return { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  }
  function bbox(P, fx0, fy0, fx1, fy1, thr) {
    const { d, w, h } = P;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = Math.round(fy0 * h); y < Math.round(fy1 * h); y++) {
      for (let x = Math.round(fx0 * w); x < Math.round(fx1 * w); x++) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mn = Math.min(r, g, b);
        if (mn > thr && Math.max(r, g, b) - mn < 42) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, W: w, H: h };
  }
  window.__P = { bar: px(bar), our: px(our) };
  const bb = bbox(window.__P.bar, 0.10, 0.24, 0.94, 0.50, 165);
  const ob = bbox(window.__P.our, 0.18, 0.26, 0.86, 0.50, 165);
  return { bar: bb, our: ob };
}, [BAR, OURS]);

console.log('BAR  BLITZ bbox', JSON.stringify(res.bar), 'w/H=', (res.bar.w / res.bar.H).toFixed(3), 'cap/H=', (res.bar.h / res.bar.H).toFixed(3));
console.log('OURS BLITZ bbox', JSON.stringify(res.our), 'w/H=', (res.our.w / res.our.H).toFixed(3), 'cap/H=', (res.our.h / res.our.H).toFixed(3));
console.log('BAR  aspect w/h', (res.bar.w / res.bar.h).toFixed(3), ' OURS', (res.our.w / res.our.h).toFixed(3));

await page.evaluate(async ([barSrc, ourSrc, r, pad]) => {
  const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = s; });
  const bar = await load(barSrc), our = await load(ourSrc);
  const H = 300;
  function crop(im, b, padk) {
    const sx = b.x0 - b.h * padk, sy = b.y0 - b.h * padk;
    const sw = b.w + b.h * padk * 2, sh = b.h + b.h * padk * 2;
    const k = H / b.h;
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  const a = crop(bar, r.bar, pad), b = crop(our, r.our, pad);
  const cv = document.getElementById('cv');
  cv.width = Math.max(a.width, b.width);
  cv.height = a.height + b.height + 12;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(a, 0, 0); c.drawImage(b, 0, a.height + 12);
  c.font = 'bold 22px monospace'; c.fillStyle = '#ffd000';
  c.fillText('BAR', 8, 26); c.fillText('OURS', 8, a.height + 38);
}, [BAR, OURS, res, Number(process.argv[4] || 0.55)]);

const el = await page.$('#cv');
await el.screenshot({ path: OUT });
console.log('wrote', OUT);
await browser.close();
