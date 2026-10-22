// Local, privacy-preserving diagnostics: what this browser supports and what failed
// while starting the editor. Nothing is sent anywhere. Developers read it from the
// "Diagnostics" panel (Copy) or the console as window.__photoEditorDiagnostics; it
// never contains file names, pixels or settings.

const entries = [];
const MAX_ENTRIES = 50;

/** Records a failure or fallback. `area` is a short operation name, e.g. 'webgl2'. */
export function recordDiagnostic(area, message, level = 'error') {
  entries.push({ at: new Date().toISOString(), area, level, message: String(message).slice(0, 500) });
  if (entries.length > MAX_ENTRIES) entries.shift();
  if (level === 'error') console.error(`[photo editor] ${area}: ${message}`);
}

export const diagnosticEntries = () => entries.slice();

/** Test hook. */
export function clearDiagnostics() {
  entries.length = 0;
}

const safely = (probe) => {
  try {
    return probe();
  } catch {
    return false;
  }
};

/**
 * Feature report for this browser. `required` lists the missing APIs the editor
 * cannot work without; everything else has a fallback.
 */
export function browserCapabilities(win = globalThis) {
  const capabilities = {
    createImageBitmap: typeof win.createImageBitmap === 'function',
    canvas2d: safely(() => Boolean(win.document.createElement('canvas').getContext('2d'))),
    blobAndFile: typeof win.Blob === 'function' && typeof win.File === 'function' && typeof win.Blob.prototype.arrayBuffer === 'function',
    workers: typeof win.Worker === 'function',
    offscreenCanvas: typeof win.OffscreenCanvas === 'function',
    webgl2: typeof win.WebGL2RenderingContext === 'function',
    cryptoSubtle: Boolean(win.crypto?.subtle),
    localStorage: safely(() => { win.localStorage.setItem('photo-editor:probe', '1'); win.localStorage.removeItem('photo-editor:probe'); return true; }),
    deviceMemoryGb: typeof win.navigator?.deviceMemory === 'number' ? win.navigator.deviceMemory : null,
  };
  const required = [
    ['createImageBitmap', 'image decoding (createImageBitmap)'],
    ['canvas2d', '2D canvas'],
    ['blobAndFile', 'reading local files (Blob.arrayBuffer)'],
  ].filter(([key]) => !capabilities[key]).map(([, label]) => label);
  return { ...capabilities, missing: required };
}

/** Plain-text report for the Copy button: capabilities, user agent and recorded events. */
export function diagnosticReport(extra = {}, win = globalThis) {
  return JSON.stringify({
    page: win.location?.pathname,
    userAgent: win.navigator?.userAgent,
    capabilities: browserCapabilities(win),
    ...extra,
    events: diagnosticEntries(),
  }, null, 2);
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__photoEditorDiagnostics', { configurable: true, get: () => diagnosticReport() });
}
