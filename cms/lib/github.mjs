// Minimal GitHub REST client for publication: open a pull request, find one, read its
// state and the deployments of a merge commit. The token stays in the local server
// process; it is never sent to the browser or written to the workspace.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export class GitHubError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Finds a token: CMS_GITHUB_TOKEN (recommended: a fine-grained token limited to this
 * repository with Contents and Pull requests write), else the GitHub CLI's login.
 * :returns: { token, source } or { token: null, source: 'none' }
 */
export async function resolveGitHubToken({ env = process.env, runGh = () => run('gh', ['auth', 'token']) } = {}) {
  if (env.CMS_GITHUB_TOKEN) return { token: env.CMS_GITHUB_TOKEN.trim(), source: 'CMS_GITHUB_TOKEN' };
  try {
    const { stdout } = await runGh();
    const token = stdout.trim();
    if (token) return { token, source: 'gh' };
  } catch {
    // gh is not installed or not logged in.
  }
  return { token: null, source: 'none' };
}

export function createGitHubClient({ owner, repo, token, fetch: fetchImpl = globalThis.fetch }) {
  const request = async (method, route, body) => {
    if (!token) throw new GitHubError('auth', 'No GitHub token: set CMS_GITHUB_TOKEN or log in with `gh auth login`.');
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}${route}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new GitHubError('network', `GitHub could not be reached: ${error.message}`);
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return data;
    const detail = data?.errors?.map((item) => item.message).filter(Boolean).join('; ') || data?.message || response.statusText;
    if (response.status === 401) throw new GitHubError('auth', `GitHub rejected the token (401): ${detail}. Log in again or replace CMS_GITHUB_TOKEN.`, 401);
    if (response.status === 403 || response.status === 404) {
      throw new GitHubError('permission', `GitHub refused ${method} ${route} (${response.status}): ${detail}. The token needs Contents and Pull requests write access to ${owner}/${repo}.`, response.status);
    }
    if (response.status === 422) throw new GitHubError('invalid', `GitHub rejected the request: ${detail}`, 422);
    throw new GitHubError('http', `GitHub returned ${response.status}: ${detail}`, response.status);
  };

  return {
    owner,
    repo,
    async createPullRequest({ head, base, title, body }) {
      const pull = await request('POST', '/pulls', { head, base, title, body, maintainer_can_modify: false, draft: false });
      return { number: pull.number, url: pull.html_url, state: pull.state };
    },
    async findOpenPullRequest(head) {
      const pulls = await request('GET', `/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`);
      const pull = pulls?.[0];
      return pull ? { number: pull.number, url: pull.html_url, state: pull.state } : null;
    },
    async getPullRequest(number) {
      const pull = await request('GET', `/pulls/${number}`);
      return {
        number: pull.number,
        url: pull.html_url,
        state: pull.merged_at ? 'merged' : pull.state,
        mergeCommit: pull.merged_at ? pull.merge_commit_sha : null,
        headSha: pull.head?.sha ?? null,
      };
    },
    /** Latest deployment status per environment for a commit (Vercel "Production", "github-pages"). */
    async deploymentStates(sha) {
      const deployments = await request('GET', `/deployments?sha=${sha}&per_page=20`);
      const states = {};
      for (const deployment of deployments ?? []) {
        if (states[deployment.environment]) continue;
        const statuses = await request('GET', `/deployments/${deployment.id}/statuses?per_page=1`);
        states[deployment.environment] = statuses?.[0]?.state ?? 'pending';
      }
      return states;
    },
  };
}
