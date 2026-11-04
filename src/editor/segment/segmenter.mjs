// Runs intelligent selections (Interval 23) with injected onnxruntime and model loading, so the
// worker (selectionWorker.mjs) and the Node quality benchmark share it. One SAM image embedding
// is kept, for the last analysis image: Subject, Background and every Object tap on the same
// photo then cost only the prompt decoder (tens of milliseconds) after the first.
import {
  encodeCodes, quantize, refineEdges, resizeMap, samCoverage, samInput, skyFromProbability, squareTensor, subjectFromParts,
} from './analysis.mjs';
import { SALIENT_PEAK, normaliseMap, rankSubjects, stability, subjectNote, subjectPrompts } from './subject.mjs';
import { MODELS, SELECTION_KINDS } from './models.mjs';
import { MASK_LIMITS } from '../model/masks.mjs';

// Room below the per-selection limit (model/masks.mjs).
const MAX_CHARS = MASK_LIMITS.selectionChars * 0.75;

export class SelectionError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * :param ort: the onnxruntime module (onnxruntime-web/wasm, or onnxruntime-node in tests)
 * :param loadModel: async (name, onProgress(fraction)) → ArrayBuffer/Uint8Array of MODELS[name]
 * :param sessionOptions: passed to InferenceSession.create
 */
export function createSegmenter({ ort, loadModel, sessionOptions = {} }) {
  const sessions = new Map();
  let embedding = null;

  async function session(name, onProgress) {
    if (!sessions.has(name)) {
      sessions.set(name, (async () => {
        const bytes = await loadModel(name, (fraction) => onProgress({ stage: 'download', model: name, fraction }));
        onProgress({ stage: 'prepare', model: name });
        return ort.InferenceSession.create(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), sessionOptions);
      })());
      sessions.get(name).catch(() => sessions.delete(name));
    }
    return sessions.get(name);
  }

  const tensor = (data, dims, type = 'float32') => new ort.Tensor(type, data, dims);
  const run = async (s, feeds) => s.run(feeds);

  async function probability(name, image, onProgress) {
    const s = await session(name, onProgress);
    const { size } = MODELS[name];
    onProgress({ stage: 'analyse', model: name });
    const out = await run(s, { [s.inputNames[0]]: tensor(squareTensor(image, size, { stretch: name === 'saliency' }), [1, 3, size, size]) });
    return out[s.outputNames[0]].data;
  }

  async function samEmbedding(image, imageKey, onProgress) {
    if (embedding?.key === imageKey) return embedding;
    const encoder = await session('samEncoder', onProgress);
    onProgress({ stage: 'analyse', model: 'samEncoder' });
    const fit = samInput(image);
    const out = await run(encoder, { input_image: tensor(fit.tensor, [fit.height, fit.width, 3]) });
    embedding = { key: imageKey, fit, emb: out.image_embeddings };
    return embedding;
  }

  /** SAM's masks for prompts (analysis pixels; labels 1 point, 0 excluded, 2 and 3 box corners), at analysis size. */
  async function samMasks(state, points, labels, image, onProgress) {
    const decoder = await session('samDecoder', onProgress);
    // Without a box SAM expects a padding point (label −1).
    const all = labels.includes(2) ? points : [...points, [0, 0]];
    const kinds = labels.includes(2) ? labels : [...labels, -1];
    const coords = new Float32Array(all.length * 2);
    all.forEach(([x, y], i) => { coords[i * 2] = x * state.fit.scale; coords[i * 2 + 1] = y * state.fit.scale; });
    const out = await run(decoder, {
      image_embeddings: state.emb,
      point_coords: tensor(coords, [1, all.length, 2]),
      point_labels: tensor(Float32Array.from(kinds), [1, kinds.length]),
      mask_input: tensor(new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: tensor(new Float32Array([0]), [1]),
      orig_im_size: tensor(new Float32Array([image.height, image.width]), [2]),
    });
    const n = image.width * image.height;
    const scores = Array.from(out.iou_predictions.data);
    // Masks 1–3 are SAM's three answers (a part to the whole); 0 is its single answer.
    return [1, 2, 3].map((k) => ({ score: Math.min(1, scores[k]), logits: out.masks.data.subarray(k * n, (k + 1) * n) }));
  }

  /**
   * Select Subject: SAM's masks for prompts from the saliency (subject.mjs), ranked. `choice` 0 is
   * the automatic answer, 1… the other distinct candidates (Next candidate).
   */
  async function subject(image, imageKey, choice, onProgress) {
    const { width, height } = image;
    const raw = resizeMap(await probability('saliency', image, onProgress), MODELS.saliency.size, MODELS.saliency.size, width, height);
    const none = { coverage: new Float32Array(width * height), found: false, confidence: 0, area: 0, regions: 0, warnings: [], candidate: 0, candidates: 0, note: 'No clear subject was found. Try Select Object and tap the subject.' };
    // Nothing stands out (an open landscape, a sky): measured peaks there are below 0.65, and at
    // least 0.77 where a subject was present (docs/photography-editor.md).
    let peak = 0;
    for (let i = 0; i < raw.length; i += 1) if (raw[i] > peak) peak = raw[i];
    if (peak < SALIENT_PEAK) return { ...none, note: 'Nothing in this photo stands out clearly as a subject. Use Select Object and tap what you want to select.' };
    const s = normaliseMap(raw);
    const prompts = subjectPrompts(s, width, height);
    if (!prompts.length) return none;
    const state = await samEmbedding(image, imageKey, onProgress);
    onProgress({ stage: 'outline' });
    const candidates = [];
    for (const prompt of prompts) {
      const corners = [[prompt.box[0], prompt.box[1]], [prompt.box[2], prompt.box[3]], prompt.point];
      const masks = await samMasks(state, corners, [2, 3, 1], image, onProgress); // eslint-disable-line no-await-in-loop
      for (const m of masks) candidates.push({ coverage: samCoverage(m.logits), score: m.score, stable: stability(m.logits) });
    }
    // The most salient point alone: SAM's largest answer for it is the whole object the salient
    // part belongs to (the car behind a tail light, the building below a tower).
    for (const prompt of prompts.filter((p) => p.source !== 'all').slice(0, 2)) {
      const masks = await samMasks(state, [prompt.point], [1], image, onProgress); // eslint-disable-line no-await-in-loop
      for (const m of masks) candidates.push({ coverage: samCoverage(m.logits), score: m.score, stable: stability(m.logits), whole: true });
    }
    const { options } = rankSubjects(candidates, s, width, height, { peak });
    if (!options.length) return none;
    const index = Math.min(options.length - 1, Math.max(0, choice));
    const option = options[index];
    const coarse = new Float32Array(width * height);
    for (const k of option.pick) { const c = candidates[k].coverage; for (let i = 0; i < c.length; i += 1) if (c[i] > coarse[i]) coarse[i] = c[i]; }
    const coverage = refineEdges(coarse, image, { band: 4 });
    let area = 0;
    for (let i = 0; i < coverage.length; i += 1) area += coverage[i];
    area /= coverage.length;
    if (area < 0.001) return none;
    return { coverage, found: true, confidence: option.confidence, area, regions: option.pick.length, warnings: option.warnings, note: subjectNote(option.warnings), candidate: index, candidates: options.length };
  }

  /**
   * One selection on an analysis image (RGBA at analysis size).
   * :param request: { kind, image, imageKey, points? [[x, y, label]] in analysis pixels, candidate? }
   * :returns: { width, height, data (encoded codes), found, confidence, area, regions, note, version, candidates? }
   */
  async function select({ kind, image, imageKey, points = [], candidate = null }, onProgress = () => {}) {
    if (!SELECTION_KINDS[kind]) throw new SelectionError(`Unknown selection: ${kind}.`, 'bad-request');
    const started = Date.now();
    let result;
    if (kind === 'sky') {
      result = skyFromProbability(await probability('sky', image, onProgress), MODELS.sky.size, image);
    } else if (kind === 'subject' || kind === 'background') {
      result = await subject(image, imageKey, candidate ?? 0, onProgress);
      if (kind === 'background' && result.found) result.note = result.warnings.length ? subjectNote(result.warnings, { background: true }) : null;
    } else {
      if (!points.length || !points.some(([, , label]) => label === 1)) throw new SelectionError('Tap the object to select first.', 'bad-request');
      const state = await samEmbedding(image, imageKey, onProgress);
      onProgress({ stage: 'outline' });
      const masks = await samMasks(state, points.map(([x, y]) => [x, y]), points.map(([, , label]) => label), image, onProgress);
      const coverages = masks.map(({ logits }) => samCoverage(logits));
      const areas = coverages.map((c) => c.reduce((sum, v) => sum + (v >= 0.5 ? 1 : 0), 0) / c.length);
      // SAM's three answers run from a part to the whole; `candidate` picks one, else the best scored.
      const order = [0, 1, 2].sort((a, b) => areas[a] - areas[b]);
      const pick = candidate !== null && order[candidate] !== undefined ? order[candidate] : masks.reduce((best, m, k) => (m.score > masks[best].score ? k : best), 0);
      const sub = subjectFromParts([{ coverage: coverages[pick], score: masks[pick].score }], [coverages[pick]], image);
      result = { ...sub, note: sub.found ? (masks[pick].score < 0.6 ? 'This outline is uncertain: add points on the object or subtract with the brush.' : null) : 'Nothing was selected there. Tap inside the object.' };
      result.candidates = order.map((k) => ({ score: masks[k].score, area: areas[k] }));
      result.candidate = order.indexOf(pick);
    }
    const { coverage, ...rest } = result;
    // A very intricate edge (a sky through bare branches) codes large: the grid is reduced until
    // it fits what one selection may hold in an edit document.
    let grid = { width: image.width, height: image.height, coverage };
    let data = rest.found ? encodeCodes(quantize(coverage)) : null;
    while (data && data.length > MAX_CHARS && grid.width > 64) {
      const width = Math.round(grid.width * 0.75);
      const height = Math.round(grid.height * 0.75);
      grid = { width, height, coverage: resizeMap(grid.coverage, grid.width, grid.height, width, height) };
      data = encodeCodes(quantize(grid.coverage));
    }
    return { ...rest, width: grid.width, height: grid.height, data, version: SELECTION_KINDS[kind].version, ms: Date.now() - started };
  }

  /** SAM's three masks for prompts (analysis pixels; labels as samMasks), for reference masks. */
  async function outline({ image, imageKey, points, labels }, onProgress = () => {}) {
    const state = await samEmbedding(image, imageKey, onProgress);
    const masks = await samMasks(state, points, labels, image, onProgress);
    return masks.map((m) => ({ score: m.score, coverage: samCoverage(m.logits) }));
  }

  return { select, outline, forgetImage: () => { embedding = null; } };
}
