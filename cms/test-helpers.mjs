// Fixtures for CMS tests: a throwaway repository (with a bare "origin") holding a small
// published catalog and real derivative files, a workspace folder, synthetic photographs,
// and a fake GitHub client. Nothing here touches the real repository or GitHub.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { serializeCatalog } from '../scripts/photography-catalog.mjs';

export const record = (id, overrides = {}) => ({
  id,
  slug: id,
  status: 'published',
  sourceFilename: `${id}.JPG`,
  caption: `Caption ${id}`,
  alt: `Alt text for ${id}`,
  shape: 'landscape',
  category: 'Places',
  ...overrides,
});

export const baseCatalog = () => ({
  schemaVersion: 1,
  captureTimeZone: 'America/New_York',
  hero: 'alpha',
  categories: ['Places', 'Nature'],
  photographs: [record('alpha', { featured: 1 }), record('beta', { category: 'Nature' }), record('gamma', { featured: 2 })],
});

export async function photograph({ width = 1600, height = 1000, format = 'jpeg', color = { r: 60, g: 110, b: 150 } } = {}) {
  return sharp({ create: { width, height, channels: 3, background: color } })[format]({ quality: 85 }).toBuffer();
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A repository with `main` holding the catalog, manifest and derivatives, cloned from a bare origin. */
export async function fixtureRepo(catalog = baseCatalog()) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cms-repo-'));
  const seed = path.join(root, 'seed');
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  mkdirSync(path.join(seed, 'src', 'data'), { recursive: true });
  mkdirSync(path.join(seed, 'src', 'assets', 'photography', 'generated'), { recursive: true });
  const manifest = [];
  for (const { id, sourceFilename } of catalog.photographs.filter(({ status }) => status === 'published')) {
    for (const [kind, width, height] of [['gallery', 900, 600], ['viewer', 2200, 1467]]) {
      writeFileSync(path.join(seed, 'src', 'assets', 'photography', 'generated', `${id}-${kind}.jpg`), await photograph({ width: 60, height: 40 }));
      if (kind === 'viewer') manifest.push({ id, sourceFilename, galleryFilename: `${id}-gallery.jpg`, viewerFilename: `${id}-viewer.jpg`, galleryWidth: 900, galleryHeight: 600, viewerWidth: width, viewerHeight: height });
    }
  }
  writeFileSync(path.join(seed, 'src', 'data', 'photography.catalog.json'), serializeCatalog(catalog));
  writeFileSync(path.join(seed, 'src', 'data', 'photographs.generated.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(seed, 'README.md'), 'fixture\n');
  git(seed, 'init', '--quiet', '--initial-branch=main');
  git(seed, 'config', 'core.autocrlf', 'false');
  git(seed, 'config', 'user.email', 'cms-test@example.invalid');
  git(seed, 'config', 'user.name', 'CMS Test');
  git(seed, 'config', 'core.autocrlf', 'false');
  git(seed, 'add', '-A');
  git(seed, 'commit', '--quiet', '-m', 'fixture');
  git(root, 'clone', '--quiet', '--bare', seed, origin);
  // core.autocrlf=false from the start, so the checkout matches the index on Windows too.
  git(root, 'clone', '--quiet', '-c', 'core.autocrlf=false', origin, repo);
  git(repo, 'config', 'user.email', 'cms-test@example.invalid');
  git(repo, 'config', 'user.name', 'CMS Test');
  git(repo, 'config', 'core.autocrlf', 'false');
  return {
    root,
    origin,
    repo,
    workspace: path.join(root, 'workspace'),
    git: (...args) => git(repo, ...args),
    /** Commits a change to origin's main from a separate clone, as a merge on GitHub would. */
    pushToMain(edit, message = 'upstream change') {
      const other = path.join(root, `other-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      git(root, 'clone', '--quiet', '-c', 'core.autocrlf=false', origin, other);
      git(other, 'config', 'user.email', 'cms-test@example.invalid');
      git(other, 'config', 'user.name', 'CMS Test');
      edit(other);
      git(other, 'add', '-A');
      git(other, 'commit', '--quiet', '-m', message);
      git(other, 'push', '--quiet', 'origin', 'main');
      return git(other, 'rev-parse', 'HEAD');
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Records calls; behaviour can be overridden per test. */
export function fakeGitHub(overrides = {}) {
  const calls = [];
  const pulls = new Map();
  let next = 101;
  const client = {
    calls,
    pulls,
    async createPullRequest(input) {
      calls.push(['createPullRequest', input]);
      const pull = { number: next++, url: `https://github.com/example/portfolio/pull/${next - 1}`, state: 'open', head: input.head };
      pulls.set(pull.number, pull);
      return pull;
    },
    async findOpenPullRequest(head) {
      calls.push(['findOpenPullRequest', head]);
      return [...pulls.values()].find((pull) => pull.head === head && pull.state === 'open') ?? null;
    },
    async getPullRequest(number) {
      calls.push(['getPullRequest', number]);
      const pull = pulls.get(number);
      return { number, url: pull.url, state: pull.state, mergeCommit: pull.mergeCommit ?? null };
    },
    async deploymentStates(sha) {
      calls.push(['deploymentStates', sha]);
      return { Production: 'success', 'github-pages': 'success' };
    },
    ...overrides,
  };
  return client;
}

/**
 * A RAW-looking file the CMS identifies by content: a TIFF header and an IFD0 with Make and
 * Model (in either byte order), padded with `fill`. Not decodable; the CMS never decodes.
 */
export function fakeRaw({ make = 'SONY', model = 'ILCE-7M3', bigEndian = false, size = 4096, fill = 7 } = {}) {
  const bytes = Buffer.alloc(Math.max(256, size), fill);
  const little = !bigEndian;
  bytes.write(little ? 'II' : 'MM', 0, 'latin1');
  const u16 = (value, at) => (little ? bytes.writeUInt16LE(value, at) : bytes.writeUInt16BE(value, at));
  const u32 = (value, at) => (little ? bytes.writeUInt32LE(value, at) : bytes.writeUInt32BE(value, at));
  u16(42, 2);
  u32(8, 4);
  u16(2, 8);
  [[0x010f, make, 64], [0x0110, model, 128]].forEach(([tag, text, at], i) => {
    const entry = 10 + i * 12;
    u16(tag, entry); u16(2, entry + 2); u32(text.length + 1, entry + 4); u32(at, entry + 8);
    bytes.write(`${text}\0`, at, 'latin1');
  });
  u32(0, 34);
  return bytes;
}
