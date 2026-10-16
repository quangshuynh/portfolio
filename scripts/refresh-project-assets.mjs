// Moves commit pins in src/data/githubAssets.mjs to each repository's latest
// commit, but only after every image the portfolio references from that
// repository has been found there: `npm run assets:refresh -- --help`.
//
// A repository that fails a check keeps its current pin (and its recorded
// sizes), so a broken push in a project repository never reaches the site. The
// run exits 1 when any requested repository was skipped. It writes only
// githubAssets.mjs and, with --update-dimensions, the width/height numbers in
// projects.mjs; both are staged, re-imported, and compared before they replace
// the originals. It runs no git commands; review the diff and commit as usual.
// See docs/PROJECT_MAINTENANCE.md.
import { deepStrictEqual } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { repositories } from '../src/data/githubAssets.mjs';
import { projects } from '../src/data/projects.mjs';
import {
  USAGE, applyDimensions, applyPins, collectExpectedAssets, formatPlan, parseArgs, planRepository, writeFilesSafely,
} from './asset-refresh.mjs';

const PINS_FILE = fileURLToPath(new URL('../src/data/githubAssets.mjs', import.meta.url));
const PROJECTS_FILE = fileURLToPath(new URL('../src/data/projects.mjs', import.meta.url));

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
  // Read once and passed only to the API helpers; never logged or written.
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined,
  measure: async (buffer) => {
    const { width, height, format, compression } = await sharp(buffer).metadata();
    if (!width || !height) throw new Error('no dimensions');
    // sharp reports AVIF as its HEIF container.
    return { width, height, format: format === 'heif' && compression === 'av1' ? 'avif' : format };
  },
};

const expected = collectExpectedAssets(projects, repositories);
const flags = [options.dryRun && 'dry run', options.updateDimensions && 'updating dimensions', options.allowAspectChange && 'allowing aspect-ratio changes'].filter(Boolean);
console.log(`${flags.length ? `${flags.join(', ')}: ` : ''}checking ${options.keys.length} repositor${options.keys.length === 1 ? 'y' : 'ies'}${deps.token ? '' : ' (no GITHUB_TOKEN, unauthenticated API limits apply)'}\n`);

// One repository at a time keeps the report in order and API use gentle;
// the files within a repository are checked in parallel.
const plans = [];
for (const key of options.keys) {
  const plan = await planRepository(key, repositories[key], expected[key], deps, options);
  plans.push(plan);
  formatPlan(plan, options.dryRun).forEach((line) => console.log(line));
}

const updates = plans.filter((plan) => plan.status === 'update');
const pinUpdates = updates.filter((plan) => plan.to !== plan.from);
const resized = updates.flatMap((plan) => plan.dimensions.map((change) => ({ ...change, key: plan.key })));
const skipped = plans.filter((plan) => plan.status === 'blocked' || plan.status === 'inaccessible');

/**
 * imports a staged module and checks it exports exactly the expected data
 * :param name: export to compare
 * :param expectedValue: value the staged file must export
 * :returns: verify callback for writeFilesSafely
 */
const exportsExactly = (name, expectedValue) => async (temp) => {
  const staged = await import(pathToFileURL(temp).href);
  deepStrictEqual(staged[name], expectedValue, `staged ${name} differs from the planned change`);
};

let wrote = [];
if (updates.length && !options.dryRun) {
  const writes = [];
  if (pinUpdates.length) {
    const original = await readFile(PINS_FILE, 'utf8');
    const next = structuredClone(repositories);
    pinUpdates.forEach((plan) => { next[plan.key].commit = plan.to; });
    writes.push({ file: PINS_FILE, original, content: applyPins(original, pinUpdates), verify: exportsExactly('repositories', next) });
  }
  if (resized.length) {
    const original = await readFile(PROJECTS_FILE, 'utf8');
    let content = original;
    for (const plan of updates.filter((entry) => entry.dimensions.length)) content = applyDimensions(content, plan.key, plan.dimensions);
    // The staged copy still imports the current pins, so only sizes may differ.
    const next = structuredClone(projects);
    for (const { slug, path, to } of resized) {
      const shot = next.find((project) => project.slug === slug).screenshots.find((entry) => entry.src?.endsWith(`/${path}`));
      Object.assign(shot, to);
    }
    writes.push({ file: PROJECTS_FILE, original, content, verify: exportsExactly('projects', next) });
  }
  try {
    wrote = await writeFilesSafely(writes);
  } catch (error) {
    console.error(`\nNothing was written: ${error.message}`);
    process.exitCode = 1;
  }
}

const summary = [
  `${updates.length} ${options.dryRun ? 'would update' : 'updated'}`,
  `${plans.filter((plan) => plan.status === 'current').length} already current`,
  `${skipped.length} skipped`,
].join(', ');
console.log(`\n${summary}${resized.length ? `; ${resized.length} recorded screenshot size${resized.length === 1 ? '' : 's'} ${options.dryRun ? 'would change' : 'changed'}` : ''}.`);
if (updates.length && options.dryRun) console.log('Nothing was written. Run again without --dry-run to apply.');
if (wrote.length) {
  console.log(`Wrote ${wrote.map((file) => `src/data/${file.split(/[\\/]/).pop()}`).join(' and ')}. Next: npm test, npm run check:assets, review git diff, commit.`);
}
if (skipped.length) console.log(`Skipped repositories keep their current pins and sizes: ${skipped.map((plan) => plan.key).join(', ')}.`);
// exitCode rather than process.exit(): exiting while fetch sockets are still
// closing trips a libuv assertion on Windows.
if (skipped.length) process.exitCode = 1;
else process.exitCode ??= 0;
