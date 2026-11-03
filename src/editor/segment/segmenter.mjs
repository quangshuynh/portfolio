// Runs intelligent selections (Interval 23) with injected onnxruntime and model loading, so the
// worker (selectionWorker.mjs) and the Node quality benchmark share it. One SAM image embedding
// is kept, for the last analysis image: Subject, Background and every Object tap on the same
// photo then cost only the prompt decoder (tens of milliseconds) after the first.
import {
  encodeCodes, quantize, regionPrompt, resizeMap, salientRegions, samCoverage, samInput, skyFromProbability, squareTensor, subjectFromParts,
} from './analysis.mjs';
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
      const saliency = await probability('saliency', image, onProgress);
      const { regions, labels } = salientRegions(saliency, MODELS.saliency.size, image);
      const parts = [];
      const regionMasks = [];
      if (regions.length) {
        const state = await samEmbedding(image, imageKey, onProgress);
        onProgress({ stage: 'outline' });
        for (const region of regions) {
          const prompt = regionPrompt(region);
          const masks = await samMasks(state, prompt.points, prompt.labels, image, onProgress);
          const best = masks.reduce((a, b) => (b.score > a.score ? b : a));
          // A region spanning the whole width or height (a band of sky, a horizon) is rarely a subject.
          const spans = (region.x0 <= 1 && region.x1 >= image.width - 2) || (region.y0 <= 1 && region.y1 >= image.height - 2);
          parts.push({ coverage: samCoverage(best.logits), score: best.score * (spans ? 0.5 : 1) });
          const own = new Uint8Array(labels.length);
          for (let i = 0; i < labels.length; i += 1) own[i] = labels[i] === region.label ? 1 : 0;
          regionMasks.push(own);
        }
      }
      result = subjectFromParts(parts, regionMasks, image);
      if (kind === 'background' && result.found) result.note = result.note?.replace('This subject is uncertain', 'The subject this background is cut around is uncertain') ?? null;
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

  return { select, forgetImage: () => { embedding = null; } };
}
