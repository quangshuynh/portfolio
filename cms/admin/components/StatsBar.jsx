export default function StatsBar({ catalog, derived, onShowProblems, onShowChanges }) {
  const published = catalog.photographs.filter(({ status }) => status === 'published').length;
  const draftProblemCount = Object.keys(derived.problems.drafts).length;
  const stats = [
    ['Photographs', catalog.photographs.length],
    ['Published', published],
    ['Drafts', catalog.photographs.length - published],
    ['Collections', catalog.categories.length],
    ['Featured', catalog.photographs.filter(({ featured }) => featured).length],
  ];
  return (
    <dl className="cms-stats">
      {stats.map(([label, value]) => (
        <div key={label} className="cms-stat"><dt>{label}</dt><dd>{value}</dd></div>
      ))}
      <div className="cms-stat">
        <dt>Pending changes</dt>
        <dd><button type="button" className="cms-stat-link" onClick={onShowChanges}>{derived.summary.count}</button></dd>
      </div>
      <div className={`cms-stat ${derived.problems.publication.length ? 'cms-stat--warn' : ''}`}>
        <dt>Problems</dt>
        <dd>
          <button type="button" className="cms-stat-link" onClick={onShowProblems}>
            {derived.problems.publication.length}
            {draftProblemCount > 0 && <small>{draftProblemCount} draft{draftProblemCount === 1 ? '' : 's'} incomplete</small>}
          </button>
        </dd>
      </div>
    </dl>
  );
}
