export const PUBLIC_METADATA_FIELDS = [
  'capturedAt', 'camera', 'lens', 'focalLength', 'aperture', 'shutterSpeed', 'iso', 'location',
];

function zonedParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)]));
}

function wallTimeToUtc(parts, timeZone) {
  const intended = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let result = intended;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const local = zonedParts(new Date(result), timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    result += intended - represented;
  }
  const roundTrip = zonedParts(new Date(result), timeZone);
  return Object.keys(parts).every((key) => parts[key] === roundTrip[key]) ? new Date(result) : null;
}

export function parseExifTimestamp(value, offset, timeZone = 'America/New_York') {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) };
  const calendarCheck = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  if (calendarCheck.getUTCFullYear() !== parts.year
    || calendarCheck.getUTCMonth() !== parts.month - 1
    || calendarCheck.getUTCDate() !== parts.day
    || calendarCheck.getUTCHours() !== parts.hour
    || calendarCheck.getUTCMinutes() !== parts.minute
    || calendarCheck.getUTCSeconds() !== parts.second) return null;
  let date;
  if (offset !== null && offset !== undefined && offset !== '') {
    const offsetMatch = String(offset).match(/^([+-])(\d{2}):(\d{2})$/);
    if (!offsetMatch || Number(offsetMatch[2]) > 23 || Number(offsetMatch[3]) > 59) return null;
    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  } else {
    date = wallTimeToUtc(parts, timeZone);
  }
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function normalizeCamera(make, model) {
  const normalizedMake = String(make ?? '').replace(/ corporation/ig, '').trim();
  const normalizedModel = String(model ?? '').trim();
  if (!normalizedModel) return normalizedMake || null;
  if (!normalizedMake || normalizedModel.toLowerCase().startsWith(normalizedMake.toLowerCase())) return normalizedModel;
  return `${normalizedMake} ${normalizedModel}`;
}

export function mergePhotographyMetadata(generated, override) {
  const merged = { ...generated, ...override };
  for (const field of PUBLIC_METADATA_FIELDS) {
    if (Object.hasOwn(override, field) && override[field] === null) delete merged[field];
  }
  return merged;
}

export function derivativeFilenames(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Unsafe photography ID: ${id}`);
  return { galleryFilename: `${id}-gallery.jpg`, viewerFilename: `${id}-viewer.jpg` };
}
