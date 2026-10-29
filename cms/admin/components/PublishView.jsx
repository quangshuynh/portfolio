import { useState } from 'react';
import { api } from '../api.js';

function ChangeList({ summary, catalog }) {
  const caption = (id) => catalog.photographs.find((record) => record.id === id)?.caption ?? id;
  const groups = [
    ['Added', summary.added.map((id) => `${caption(id)} (${id})`)],
    ['Withdrawn', summary.withdrawn],
    ['Edited', summary.edited.map(({ id, fields }) => `${id}: ${fields.join(', ')}`)],
    ['Reordered', summary.moved],
    ['New images from QuangEdit', (summary.images ?? []).map((id) => `${caption(id)} (${id})`)],
    ['Featured', summary.featured ? [`${summary.featured.before.join(', ') || 'none'} → ${summary.featured.after.join(', ') || 'none'}`] : []],
    ['Hero', summary.hero ? [`${summary.hero.before} → ${summary.hero.after}`] : []],
    ['Collections', summary.collections ? [`${summary.collections.before.join(', ')} → ${summary.collections.after.join(', ')}`] : []],
  ].filter(([, items]) => items.length);
  if (!groups.length) return <p className="cms-lede">No public changes. {summary.drafts ? `${summary.drafts} draft${summary.drafts === 1 ? '' : 's'} stay private.` : ''}</p>;
  return (
    <dl className="cms-changes">
      {groups.map(([title, items]) => (
        <div key={title}><dt>{title} ({items.length})</dt>{items.map((item) => <dd key={item}>{item}</dd>)}</div>
      ))}
    </dl>
  );
}

const STEP_STATES = ['Local changes', 'Pull request', 'Merged', 'Deployed'];

function stepIndex(publication, pending) {
  if (!publication || ['closed', 'dry-run'].includes(publication.status)) return pending ? 0 : -1;
  if (publication.status === 'merged') return publication.deployed ? 3 : 2;
  return 1;
}

export default function PublishView({ ws, onNotice }) {
  const { server, catalog, derived } = ws;
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);
  const publication = server.publication;
  const summary = derived.summary;
  const problems = derived.problems;
  const unfinished = publication && ['committed', 'pushed'].includes(publication.status);
  const open = publication?.status === 'pr-open';
  const canPublish = !problems.publication.length && (summary.count > 0 || unfinished) && !open && ws.save.status === 'saved';

  async function act(name, action, success) {
    setBusy(name);
    setFailure(null);
    try {
      await ws.flush();
      const data = await action();
      ws.replace(data);
      if (success) onNotice({ tone: 'ok', text: success(data) });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  const step = stepIndex(publication, summary.count > 0);
  return (
    <section className="cms-publish" aria-labelledby="publish-title">
      <h1 id="publish-title" className="cms-title">Publish</h1>
      <p className="cms-lede">
        Publishing opens a pull request on GitHub. Nothing changes on quanghuynh.com until you review and merge it, and the deployment finishes.
        Photographs in the pull request become visible on GitHub (and its Vercel preview) as soon as it is opened; drafts are never included.
      </p>

      <ol className="cms-steps" aria-label="Publication progress">
        {STEP_STATES.map((label, index) => (
          <li key={label} className={index < step ? 'is-done' : index === step ? 'is-current' : ''} aria-current={index === step ? 'step' : undefined}>{label}</li>
        ))}
      </ol>

      <div className="cms-publish-grid">
        <section className="cms-card" aria-labelledby="pending-title">
          <h2 id="pending-title">Pending changes · {summary.count}</h2>
          <ChangeList summary={summary} catalog={catalog} />
          {open && !server.submittedUnchanged && <p className="cms-warning">You have edited the workspace since pull request #{publication.number} was opened. Those edits will go into the next publication.</p>}
        </section>

        <section className="cms-card" aria-labelledby="checks-title">
          <h2 id="checks-title">Checks</h2>
          {problems.publication.length ? (
            <ul className="cms-errors">{problems.publication.map((error) => <li key={error}>{error}</li>)}</ul>
          ) : <p className="cms-ok">The publication catalog is valid.</p>}
          {Object.keys(problems.drafts).length > 0 && (
            <p className="cms-field-hint">{Object.keys(problems.drafts).length} draft(s) are incomplete. Drafts are not published, so they do not block publication.</p>
          )}
        </section>

        <section className="cms-card" aria-labelledby="pr-title">
          <h2 id="pr-title">Pull request</h2>
          {!publication && <p className="cms-lede">None yet.</p>}
          {publication?.status === 'dry-run' && <p>Dry run: local branch <code>{publication.branch}</code> at <code>{publication.commit.slice(0, 12)}</code>, not pushed.</p>}
          {unfinished && <p className="cms-warning">Branch <code>{publication.branch}</code> was {publication.status === 'pushed' ? 'pushed, but the pull request was not opened' : 'committed, but not pushed'}. Retry to finish it.</p>}
          {publication?.number && (
            <p>
              <a href={publication.url} target="_blank" rel="noreferrer">#{publication.number}</a>{' '}
              {publication.status === 'pr-open' && 'is open: review and merge it on GitHub.'}
              {publication.status === 'closed' && 'was closed without merging.'}
              {publication.status === 'merged' && <>was merged as <code>{publication.mergeCommit?.slice(0, 12)}</code>.</>}
            </p>
          )}
          {publication?.status === 'merged' && (
            <ul className="cms-deployments">
              {Object.entries(publication.deployments ?? {}).map(([environment, state]) => <li key={environment}>{environment}: {state}</li>)}
              {!Object.keys(publication.deployments ?? {}).length && <li>No deployment reported yet.</li>}
            </ul>
          )}
          {publication?.checkedAt && <p className="cms-field-hint">Checked {new Date(publication.checkedAt).toLocaleString()}.</p>}
        </section>
      </div>

      {failure && (
        <div className="cms-failure" role="alert">
          <strong>{failure.message}</strong>
          {failure.details?.errors && <ul>{failure.details.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
          {failure.details?.conflicts && <ul>{failure.details.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul>}
          {failure.details?.url && <p><a href={failure.details.url} target="_blank" rel="noreferrer">Open the pull request</a></p>}
        </div>
      )}

      <div className="cms-publish-actions">
        <a className="cms-button" href="/photography/" target="_blank" rel="noreferrer">Preview gallery ↗</a>
        <button type="button" className="cms-button cms-button--primary" disabled={!canPublish || !server.github.available || Boolean(busy)}
          onClick={() => act('prepare', () => api.prepare(false), (data) => `Pull request #${data.result.number} opened. Review and merge it on GitHub.`)}>
          {busy === 'prepare' ? 'Preparing…' : unfinished ? 'Retry publication' : 'Prepare publication'}
        </button>
        <button type="button" className="cms-button" disabled={!canPublish || unfinished || Boolean(busy)}
          onClick={() => act('dry', () => api.prepare(true), (data) => `Dry run committed to local branch ${data.result.branch}; nothing was pushed.`)}>
          Dry run
        </button>
        <button type="button" className="cms-button" disabled={!publication?.number || Boolean(busy)}
          onClick={() => act('status', () => api.status(), (data) => `Status: ${data.publication?.status}.`)}>Refresh status</button>
        <button type="button" className="cms-button" disabled={Boolean(busy) || server.github.offline}
          onClick={() => act('rebase', () => api.rebase(), (data) => (data.rebased ? 'Workspace updated to the latest base branch.' : 'Already up to date.'))}>Update from base branch</button>
        {publication && ['closed', 'merged', 'dry-run'].includes(publication.status) && (
          <button type="button" className="cms-button" disabled={Boolean(busy)} onClick={() => act('forget', () => api.forget(), () => 'Publication record cleared.')}>Clear record</button>
        )}
        <button type="button" className="cms-button cms-button--danger" disabled={!summary.count || Boolean(busy)}
          onClick={() => window.confirm('Discard all unpublished public changes? New drafts and uploads are kept.')
            && act('discard', () => api.discard(server.revision), () => 'Pending changes discarded.')}>Discard changes</button>
      </div>
      {!server.github.available && (
        <p className="cms-field-hint">
          {server.github.offline ? 'Started with --offline: only dry runs are possible.' : 'GitHub is not connected: set CMS_GITHUB_TOKEN or run gh auth login, then restart the CMS.'}
        </p>
      )}
      {server.github.source === 'gh' && <p className="cms-field-hint">Using the GitHub CLI login, which has broad access. For least privilege, set CMS_GITHUB_TOKEN to a fine-grained token limited to this repository.</p>}
    </section>
  );
}
