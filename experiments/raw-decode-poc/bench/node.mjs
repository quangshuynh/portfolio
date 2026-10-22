// Times LibRaw-Wasm decodes of RAW_FIXTURE in Node (same V8 engine as Chromium, no
// worker or transfer overhead) and prints a JSON report.
//
//   RAW_FIXTURE=path/to.ARW RUNS=3 npm run bench:node
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { LINEAR_SETTINGS, loadLibRaw } from '../src/decode.mjs';

const fixturePath = process.env.RAW_FIXTURE;
if (!fixturePath) throw new Error('Set RAW_FIXTURE.');
const runs = Number(process.env.RUNS ?? 3);
const bytes = new Uint8Array(await readFile(fixturePath));

const CASES = [
  ['full linear (userQual 0)', { ...LINEAR_SETTINGS, userQual: 0 }],
  ['full AHD (userQual 3)', LINEAR_SETTINGS],
  ['full DHT (userQual 11)', { ...LINEAR_SETTINGS, userQual: 11 }],
  ['half-size', { ...LINEAR_SETTINGS, halfSize: true }],
];

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const Module = await loadLibRaw();
const report = { node: process.version, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, fixtureBytes: bytes.byteLength, cases: [] };

for (const [name, settings] of CASES) {
  const times = [];
  let shape;
  let peakRss = 0;
  for (let run = 0; run < runs; run += 1) {
    const raw = new Module.LibRaw();
    const started = performance.now();
    raw.open(bytes.slice(), { ...settings });
    const image = raw.imageData();
    times.push(performance.now() - started);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    shape = `${image.width}x${image.height}x${image.colors}@${image.bits}`;
    raw.delete();
  }
  report.cases.push({ name, output: shape, medianMs: Math.round(median(times)), runsMs: times.map(Math.round), peakRssMB: Math.round(peakRss / 2 ** 20) });
}

console.log(JSON.stringify(report, null, 2));
