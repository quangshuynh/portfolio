// Synthetic composites with exact ground-truth alpha at 6000×4000: real photo backgrounds,
// a real car-paint texture, antialiased SVG shapes (librsvg coverage = exact alpha).
// The owner's photos give the backgrounds and the paint texture (never committed); ONLY=a,b limits scenes.
// Usage: node synth.mjs <originalsDir> <outDir>
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [orig, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = 6000; const H = 4000;
const toLin = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
const toSrgb = (v) => { v = Math.min(1, Math.max(0, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); };

async function rgb(file, w = W, h = H, extract = null) {
  let img = sharp(file).rotate();
  if (extract) img = img.extract(extract);
  const { data } = await img.resize(w, h, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}
async function alphaFromSvg(svg) {
  const { data } = await sharp(Buffer.from(svg)).resize(W, H).greyscale().raw().toBuffer({ resolveWithObject: true });
  const a = new Float32Array(W * H);
  for (let i = 0; i < a.length; i += 1) a[i] = data[i * (data.length / (W * H))] / 255;
  return a;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="black"/>${body}</svg>`;
// A car side view: body, cabin (opaque here; glass separately), wheels with spoke holes, mirror on a stalk, antenna, wing on struts.
const carShapes = (x0 = 900, y0 = 1500) => {
  const wheel = (cx) => {
    let holes = '';
    for (let k = 0; k < 5; k += 1) {
      const a0 = (k / 5) * Math.PI * 2; const a1 = a0 + 0.42;
      const p = (r, a) => `${cx + r * Math.cos(a)},${y0 + 1450 + r * Math.sin(a)}`;
      holes += `M ${p(120, a0)} L ${p(330, a0)} A 330 330 0 0 1 ${p(330, a1)} L ${p(120, a1)} A 120 120 0 0 0 ${p(120, a0)} Z `;
    }
    return `<path fill-rule="evenodd" fill="white" d="M ${cx - 420},${y0 + 1450} a 420 420 0 1 0 840 0 a 420 420 0 1 0 -840 0 Z ${holes}"/>`;
  };
  return [
    `<path fill="white" d="M ${x0},${y0 + 1350} C ${x0 - 40},${y0 + 900} ${x0 + 200},${y0 + 800} ${x0 + 700},${y0 + 700} L ${x0 + 1500},${y0 + 600} C ${x0 + 1800},${y0 + 200} ${x0 + 2300},${y0 + 120} ${x0 + 2900},${y0 + 150} C ${x0 + 3400},${y0 + 180} ${x0 + 3700},${y0 + 450} ${x0 + 3950},${y0 + 650} L ${x0 + 4250},${y0 + 720} C ${x0 + 4400},${y0 + 800} ${x0 + 4400},${y0 + 1200} ${x0 + 4300},${y0 + 1350} Z"/>`,
    wheel(x0 + 950), wheel(x0 + 3550),
    // mirror on a 14 px stalk
    `<rect fill="white" x="${x0 + 1640}" y="${y0 + 520}" width="14" height="110"/><ellipse fill="white" cx="${x0 + 1600}" cy="${y0 + 500}" rx="110" ry="60"/>`,
    // antenna 4 px, 600 px tall, slanted
    `<line stroke="white" stroke-width="4" x1="${x0 + 3300}" y1="${y0 + 300}" x2="${x0 + 3450}" y2="${y0 - 300}"/>`,
    // rear wing on two 10 px struts
    `<rect fill="white" x="${x0 + 3900}" y="${y0 + 380}" width="10" height="300"/><rect fill="white" x="${x0 + 4150}" y="${y0 + 400}" width="10" height="320"/><path fill="white" d="M ${x0 + 3750},${y0 + 360} L ${x0 + 4380},${y0 + 330} L ${x0 + 4400},${y0 + 400} L ${x0 + 3760},${y0 + 420} Z"/>`,
  ].join('');
};
const glass = (x0 = 900, y0 = 1500) => `<path fill="white" d="M ${x0 + 1650},${y0 + 590} C ${x0 + 1900},${y0 + 260} ${x0 + 2300},${y0 + 210} ${x0 + 2850},${y0 + 230} C ${x0 + 3250},${y0 + 250} ${x0 + 3500},${y0 + 420} ${x0 + 3700},${y0 + 600} Z"/>`;

function compose(fg, bg, alpha, glassA = null, glassTint = [20, 25, 30]) {
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i += 1) {
    const a = alpha[i];
    const g = glassA ? glassA[i] * a : 0; // glass: within the body, partly see-through
    for (let c = 0; c < 3; c += 1) {
      const f = toLin[fg[i * 3 + c]]; const b = toLin[bg[i * 3 + c]];
      const fgc = g ? (1 - g) * f + g * (0.45 * toLin[glassTint[c]] + 0.55 * b) : f;
      img[i * 3 + c] = toSrgb(a * fgc + (1 - a) * b);
    }
  }
  return img;
}
// Effective alpha of glass: 0.55 of the background shows through.
const gtWithGlass = (alpha, glassA) => alpha.map((a, i) => a * (1 - 0.55 * (glassA ? glassA[i] : 0)));

function blurX(arr, channels, r) {
  const out = new Float32Array(arr.length);
  for (let y = 0; y < H; y += 1) {
    for (let c = 0; c < channels; c += 1) {
      let sum = 0; const row = y * W;
      for (let x = -r; x <= r; x += 1) sum += arr[(row + Math.min(W - 1, Math.max(0, x))) * channels + c];
      for (let x = 0; x < W; x += 1) {
        out[(row + x) * channels + c] = sum / (2 * r + 1);
        sum += arr[(row + Math.min(W - 1, x + r + 1)) * channels + c] - arr[(row + Math.max(0, x - r)) * channels + c];
      }
    }
  }
  return out;
}
function blurY(arr, channels, r) {
  const out = new Float32Array(arr.length);
  for (let x = 0; x < W; x += 1) {
    for (let c = 0; c < channels; c += 1) {
      let sum = 0;
      for (let y = -r; y <= r; y += 1) sum += arr[(Math.min(H - 1, Math.max(0, y)) * W + x) * channels + c];
      for (let y = 0; y < H; y += 1) {
        out[(y * W + x) * channels + c] = sum / (2 * r + 1);
        sum += arr[(Math.min(H - 1, y + r + 1) * W + x) * channels + c] - arr[(Math.max(0, y - r) * W + x) * channels + c];
      }
    }
  }
  return out;
}
// Blur the foreground layer (premultiplied) and its alpha together: motion (x only) or defocus (3 box passes).
function blurLayer(fg, alpha, { motion = 0, defocus = 0 }) {
  const pre = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i += 1) { for (let c = 0; c < 3; c += 1) pre[i * 4 + c] = toLin[fg[i * 3 + c]] * alpha[i]; pre[i * 4 + 3] = alpha[i]; }
  let b = pre;
  if (motion) b = blurX(b, 4, motion);
  for (let k = 0; k < (defocus ? 3 : 0); k += 1) b = blurY(blurX(b, 4, defocus), 4, defocus);
  const a = new Float32Array(W * H); const f = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i += 1) { a[i] = b[i * 4 + 3]; for (let c = 0; c < 3; c += 1) f[i * 3 + c] = toSrgb(a[i] > 1e-4 ? b[i * 4 + c] / a[i] : 0); }
  return { fg: f, alpha: a };
}

async function save(name, img, alpha, box, note) {
  if (ONLY && !ONLY.includes(name)) return;
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 3 }).toFile(path.join(out, `${name}.png`));
  const a8 = Buffer.alloc(W * H); for (let i = 0; i < a8.length; i += 1) a8[i] = Math.round(alpha[i] * 255);
  await sharp(a8, { raw: { width: W, height: H, channels: 1 } }).png({ compressionLevel: 3 }).toFile(path.join(out, `${name}.alpha.png`));
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ box, note }));
  console.log('wrote', name);
}

const O = (id) => path.join(orig, `${id}.JPG`);
const paint = await rgb(O('DSC09692'), W, H, { left: 1300, top: 2950, width: 2200, height: 700 }); // purple body side (portrait original after rotate)
const wallBg = await rgb(O('DSC09907'));
const nightBg = await rgb(O('DSC00034'));
const brickBg = await rgb(O('DSC09579'));
const ONLY = process.env.ONLY?.split(',');
const treesBg = await rgb(O('DSC00009'));
const carA = await alphaFromSvg(svg(carShapes()));
const glassA = await alphaFromSvg(svg(glass()));
const carBox = [800 / W, 1150 / H, 5400 / W, 3450 / H];

// 1 car against a building (block wall, dark SUV)
await save('car-building', compose(paint, wallBg, carA, glassA), gtWithGlass(carA, glassA), carBox, 'purple car, glass windows, spoke holes, mirror stalk, 4 px antenna, wing struts; block wall and SUV');
// 2 dark car on dark background
{
  const dark = Buffer.from(paint.map((v) => Math.round(v * 0.16)));
  const darkBg = nightBg;
  await save('dark-on-dark', compose(dark, darkBg, carA, glassA, [8, 8, 10]), gtWithGlass(carA, glassA), carBox, 'near-black car on a darkened wall/SUV');
}
// 3 bright reflective panels over trees and brick
{
  const shiny = Buffer.alloc(paint.length);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3; const spec = Math.max(0, 1 - Math.abs(y - 2100 - 0.08 * (x - 3000)) / 160) ** 2;
    for (let c = 0; c < 3; c += 1) shiny[i + c] = Math.min(255, Math.round(150 + paint[i + c] * 0.4 + 140 * spec));
  }
  await save('reflective-trees', compose(shiny, treesBg, carA, glassA, [60, 70, 80]), gtWithGlass(carA, glassA), carBox, 'light, specular car over trees and a brick wall');
}
// 4 motion blur (24 px) and 5 defocus
{
  const m = blurLayer(paint, carA, { motion: 24 });
  await save('motion-blur', compose(m.fg, brickBg, m.alpha), m.alpha, carBox, 'car without glass, 49 px horizontal motion blur');
  const d = blurLayer(paint, carA, { defocus: 4 });
  await save('defocus', compose(d.fg, treesBg, d.alpha), d.alpha, carBox, 'car without glass, defocused (3 × 9 px boxes)');
}
// 6 branches (1–10 px) over trees background: thin dark structure
{
  const r = rng(7); let body = '';
  const branch = (x, y, a, len, w, depth) => {
    if (depth > 7 || w < 1) return;
    const x2 = x + len * Math.cos(a); const y2 = y + len * Math.sin(a);
    body += `<line stroke="white" stroke-linecap="round" stroke-width="${w.toFixed(1)}" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    const n = 2 + Math.floor(r() * 2);
    for (let k = 0; k < n; k += 1) branch(x2, y2, a + (r() - 0.5) * 1.2, len * (0.6 + r() * 0.2), w * 0.62, depth + 1);
  };
  branch(3000, 3900, -Math.PI / 2, 1100, 70, 0);
  const a = await alphaFromSvg(svg(body));
  const bark = Buffer.from(paint.map((v, i) => Math.round(40 + (v % 30))));
  await save('branches', compose(bark, brickBg, a), a, [0.05, 0.02, 0.95, 0.99], 'tree of 70 → 1 px branches over a wall');
}
// 7 hair/fur: a blob with many 1–3 px strands, alpha < 1 at the tips
{
  const r = rng(11); let body = '<ellipse fill="white" cx="3000" cy="2100" rx="900" ry="700"/>';
  for (let k = 0; k < 1400; k += 1) {
    const t = r() * Math.PI * 2; const x = 3000 + 880 * Math.cos(t); const y = 2100 + 680 * Math.sin(t);
    const len = 80 + r() * 260; const bend = (r() - 0.5) * 0.9;
    const x2 = x + len * Math.cos(t + bend); const y2 = y + len * Math.sin(t + bend);
    const cx = x + len * 0.5 * Math.cos(t); const cy = y + len * 0.5 * Math.sin(t);
    body += `<path fill="none" stroke="white" stroke-opacity="${(0.55 + r() * 0.45).toFixed(2)}" stroke-width="${(1 + r() * 2).toFixed(1)}" d="M ${x.toFixed(1)},${y.toFixed(1)} Q ${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"/>`;
  }
  const a = await alphaFromSvg(svg(body));
  const fur = Buffer.alloc(paint.length);
  for (let i = 0; i < fur.length; i += 3) { fur[i] = 200 + (paint[i] % 40); fur[i + 1] = 160 + (paint[i + 1] % 40); fur[i + 2] = 110; }
  await save('fur', compose(fur, treesBg, a), a, [0.32, 0.27, 0.68, 0.78], 'light fur blob with 1400 strands over foliage');
}
// 8 chain-link fence panel (3 px wires) with posts
{
  let body = '<rect fill="white" x="1200" y="900" width="40" height="2600"/><rect fill="white" x="4760" y="900" width="40" height="2600"/>';
  for (let k = -40; k < 60; k += 1) {
    body += `<line stroke="white" stroke-width="3" x1="${1240 + k * 90}" y1="900" x2="${1240 + k * 90 + 2600}" y2="3500"/>`;
    body += `<line stroke="white" stroke-width="3" x1="${1240 + k * 90}" y1="900" x2="${1240 + k * 90 - 2600}" y2="3500"/>`;
  }
  body = `<clipPath id="c"><rect x="1200" y="900" width="3600" height="2600"/></clipPath><g clip-path="url(#c)">${body}</g>`;
  const a = await alphaFromSvg(svg(body));
  const metal = Buffer.alloc(paint.length, 175);
  await save('fence', compose(metal, treesBg, a), a, [0.19, 0.21, 0.81, 0.89], 'chain-link fence (3 px wires) over foliage');
}
