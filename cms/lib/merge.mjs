// Three-way merge of catalogs, used when the public catalog on the base branch has moved
// since the workspace was started. Field-level per photograph: a side that left a value
// as it was in `base` yields to the side that changed it; both changing it differently
// is a conflict. Nothing is guessed: any conflict means no merged catalog.
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const FIELDS = ['slug', 'status', 'sourceFilename', 'caption', 'alt', 'shape', 'category', 'tags', 'featured', 'metadata'];
const TOP_LEVEL = ['captureTimeZone', 'hero', 'categories'];

function pick(label, base, ours, theirs, conflicts) {
  if (same(ours, theirs) || same(theirs, base)) return ours;
  if (same(ours, base)) return theirs;
  conflicts.push(label);
  return ours;
}

/**
 * :param base: public catalog the workspace started from
 * :param ours: workspace catalog (may contain drafts)
 * :param theirs: current public catalog on the base branch
 * :returns: { catalog, conflicts } where catalog is null when conflicts is non-empty
 */
export function mergeCatalogs(base, ours, theirs) {
  const conflicts = [];
  const byId = (catalog) => new Map(catalog.photographs.map((record) => [record.id, record]));
  const [b, o, t] = [byId(base), byId(ours), byId(theirs)];

  const merged = {};
  for (const key of TOP_LEVEL) merged[key] = pick(`"${key}" changed on both sides`, base[key], ours[key], theirs[key], conflicts);

  const records = new Map();
  for (const id of new Set([...o.keys(), ...t.keys()])) {
    const [inBase, inOurs, inTheirs] = [b.get(id), o.get(id), t.get(id)];
    if (inOurs && inTheirs) {
      const record = { id };
      for (const field of FIELDS) {
        const value = pick(`"${id}": ${field} changed on both sides`, inBase?.[field], inOurs[field], inTheirs[field], conflicts);
        if (value !== undefined) record[field] = value;
      }
      records.set(id, record);
    } else if (inOurs) {
      // Removed on the base branch: keep it only if we never had it or did not change it.
      if (!inBase) records.set(id, inOurs);
      else if (!same(inOurs, inBase)) conflicts.push(`"${id}" was removed on the base branch but edited in the workspace`);
    } else if (inTheirs) {
      if (!inBase) records.set(id, inTheirs);
      else if (!same(inTheirs, inBase)) conflicts.push(`"${id}" was removed in the workspace but edited on the base branch`);
    }
  }

  // Order: take the side that reordered; if both reordered the shared photographs, conflict.
  const order = (catalog) => catalog.photographs.map(({ id }) => id).filter((id) => records.has(id) && b.has(id));
  const baseOrder = base.photographs.map(({ id }) => id).filter((id) => records.has(id));
  const [ourOrder, theirOrder] = [order(ours), order(theirs)];
  const ourMoved = !same(ourOrder, baseOrder.filter((id) => ourOrder.includes(id)));
  const theirMoved = !same(theirOrder, baseOrder.filter((id) => theirOrder.includes(id)));
  if (ourMoved && theirMoved && !same(ourOrder, theirOrder)) conflicts.push('The curated order changed on both sides');
  const primary = ourMoved || !theirMoved ? ours : theirs;
  const secondary = primary === ours ? theirs : ours;

  // Lay out the primary side, then insert the other side's new photographs after the
  // photograph that precedes them there.
  const ids = primary.photographs.map(({ id }) => id).filter((id) => records.has(id));
  secondary.photographs.forEach(({ id }, index) => {
    if (ids.includes(id) || !records.has(id)) return;
    const anchor = secondary.photographs.slice(0, index).reverse().find((record) => ids.includes(record.id));
    ids.splice(anchor ? ids.indexOf(anchor.id) + 1 : 0, 0, id);
  });

  if (conflicts.length) return { catalog: null, conflicts };
  return { catalog: { schemaVersion: ours.schemaVersion, ...merged, photographs: ids.map((id) => records.get(id)) }, conflicts };
}
