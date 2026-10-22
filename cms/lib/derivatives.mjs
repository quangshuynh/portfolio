// Runs the existing image pipeline (scripts/prepare-photography.mjs: sharp, mozjpeg,
// auto-orientation, metadata stripping, no GPS) against folders outside the repository,
// so CMS previews and published derivatives come from exactly the same code.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { projectRoot } from '../../scripts/photography-catalog-files.mjs';

const run = promisify(execFile);
const script = path.join(projectRoot, 'scripts', 'prepare-photography.mjs');

export class DerivativeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DerivativeError';
  }
}

export async function prepareDerivatives({ catalogFile, sourceDir, outputDir, manifest, only }) {
  try {
    await run(process.execPath, [script, '--catalog', catalogFile, '--source-dir', sourceDir, '--output-dir', outputDir,
      '--manifest', manifest, '--only', only.join(',')], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new DerivativeError(`Image generation failed for ${only.join(', ')}: ${(error.stderr || error.message).trim()}`);
  }
}
