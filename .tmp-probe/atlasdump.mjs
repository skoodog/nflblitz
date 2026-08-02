// Rasterise the impact-fx atlas outside the browser and write a PNG.
import zlib from 'node:zlib';
import fs from 'node:fs';
import { RECIPE } from '../src/pieces/impact-fx/atlas.js';
import { ATLAS_SIZE, ATLAS_GRID, ATLAS_INSET } from '../src/pieces/impact-fx/config.js';

const C = ATLAS_SIZE / ATLAS_GRID, HALF = C / 2, USABLE = (HALF - ATLAS_INSET) / HALF;
const W = ATLAS_SIZE, H = ATLAS_SIZE;
const px = new Uint8Array(W * H * 4);
const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
for (let cell = 0; cell < 16; cell++) {
  const fn = RECIPE[cell];
  const cx = (cell % 4) * C, cy = Math.floor(cell / 4) * C;
  for (let y = 0; y < C; y++) {
    const ny = -((y + 0.5) / HALF - 1);
    for (let x = 0; x < C; x++) {
      const nx = (x + 0.5) / HALF - 1;
      const r = Math.hypot(nx, ny);
      const c = fn ? fn(nx, ny, r) : [0, 0, 0, 0];
      const keep = r <= USABLE ? 1 : 0;
      const i = ((cy + y) * W + (cx + x)) * 4;
      px[i] = cl(c[0]) * 255; px[i+1] = cl(c[1]) * 255; px[i+2] = cl(c[2]) * 255;
      px[i+3] = cl(c[3]) * keep * 255;
    }
  }
}
// composite over mid-grey so alpha-only sprites are visible, then encode
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = y * (W * 4 + 1) + 1 + x * 4;
    const a = px[s+3] / 255;
    const bg = ((x >> 4) + (y >> 4)) % 2 ? 40 : 64;
    raw[d] = px[s] * a + bg * (1 - a);
    raw[d+1] = px[s+1] * a + bg * (1 - a);
    raw[d+2] = px[s+2] * a + bg * (1 - a);
    raw[d+3] = 255;
  }
}
const crcT = []; for (let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcT[n]=c>>>0;}
const crc=(b)=>{let c=0xffffffff;for(const v of b)c=crcT[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(td));return Buffer.concat([l,td,cc]);};
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=6;
fs.writeFileSync(process.argv[2], Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr),
  chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', process.argv[2]);
