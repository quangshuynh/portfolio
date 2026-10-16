// Moves commit pins in src/data/githubAssets.mjs to each repository's latest
// commit, but only after every image the portfolio references from that
// repository has been found there: `npm run assets:refresh -- --help`.
//
// A repository that fails a check keeps its current pin, so a broken push in a
// project repository never reaches the site. The run exits 1 when any requested
// repository was skipped. It writes only githubAssets.mjs and runs no git
// commands; review the diff and commit as usual. See docs/project-assets.md.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { repositories } from '../src/data/githubAssets.mjs';
import { projects } from '../src/data/projects.mjs';
import { USAGE, applyPins, collectExpectedAssets, formatPlan, parseArgs, planRepository } from './asset-refresh.mjs';

const PINS_FILE = new URL('../src/data/githubAssets.mjs', import.meta.url);

let options;
try {
  options = parseArgs(process.argv.slice(2), Object.keys(repositories));
} catch (error) {
  console.error(`${error.message}\n\n${USAGE}`);
  process.exit(2);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const deps = {
  fetch,
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined,
  measure: async (buffer) => {
    const { width, height } = await sharp(buffer).metadata();
    if (!width || !height) throw new Error('no dimensions');
    return { width, height };
  },
};

const expected = collectExpectedAssets(projects, repositories);
console.log(`${options.dryRun ? 'Dry run: ' : ''}checking ${options.keys.length} repositor${options.keys.length === 1 ? 'y' : 'ies'}${deps.token ? '' : ' (no GITHUB_TOKEN, unauthenticated API limits apply)'}\n`);

// One repository at a time keeps the report in order and API use gentle;
// the files within a repository are checked in parallel.
const plans = [];
for (const key of options.keys) {
  const plan = await planRepository(key, repositories[key], expected[key], deps);
  plans.push(plan);
  formatPlan(plan, options.dryRun).forEach((line) => console.log(line));
}

const updates = plans.filter((plan) => plan.status === 'update');
const skipped = plans.filter((plan) => plan.status === 'blocked' || plan.status === 'inaccessible');

if (updates.length && !options.dryRun) {
  const source = await readFile(PINS_FILE, 'utf8');
  await writeFile(PINS_FILE, applyPins(source, updates));
}

const summary = [
  `${updates.length} ${options.dryRun ? 'would update' : 'updated'}`,
  `${plans.filter((plan) => plan.status === 'current').length} already current`,
  `${skipped.length} skipped`,
].join(', ');
console.log(`\n${summary}.`);
if (updates.length) {
  console.log(options.dryRun
    ? 'Nothing was written. Run again without --dry-run to apply.'
    : 'Wrote src/data/githubAssets.mjs. Next: npm test, npm run check:assets, review git diff, commit.');
}
if (skipped.length) console.log(`Skipped repositories keep their current pins: ${skipped.map((plan) => plan.key).join(', ')}.`);
// exitCode rather than process.exit(): exiting while fetch sockets are still
// closing trips a libuv assertion on Windows.
process.exitCode = skipped.length ? 1 : 0;
