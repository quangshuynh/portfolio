// Thin wrapper around the git CLI. Uses the owner's existing git credentials for pushes;
// output is redacted so a credential embedded in a remote URL never reaches a log or the UI.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function redact(text) {
  return String(text ?? '')
    .replace(/(https?:\/\/)[^/@\s]+@/g, '$1***@')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***');
}

export class GitError extends Error {
  constructor(args, error) {
    super(redact(`git ${args.join(' ')} failed: ${(error.stderr || error.message || '').trim()}`));
    this.name = 'GitError';
    this.stderr = redact(error.stderr);
  }
}

export function createGit(cwd, { env } = {}) {
  const git = async (args, options = {}) => {
    try {
      const { stdout } = await run('git', args, {
        cwd: options.cwd ?? cwd,
        env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 64 * 1024 * 1024,
      });
      return options.raw ? stdout : stdout.trim();
    } catch (error) {
      throw new GitError(args, error);
    }
  };
  git.cwd = cwd;
  return git;
}

/** owner/repo from a GitHub remote URL (https or ssh). */
export function parseGitHubRemote(url) {
  const match = String(url).match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}
