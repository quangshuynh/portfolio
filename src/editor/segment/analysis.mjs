// Intelligent selections (Interval 23): the image processing around the segmentation models,
// kept free of browser and model APIs so the same code runs in the worker, in Node tests and
// in the quality benchmark. Models (segment/models.mjs) only ever see the analysis image: the
// photo's development, uncropped (the mask's 'image' space), at most ANALYSIS_EDGE px.
//
// - Sky: a sky segmentation network (U²-Net) gives a 320 × 320 probability; regions that are
//   too small or never certain are dropped, and the rest is refined against the photo with a
//   guided filter so its edge follows the photo's edges (trees, roofs, wires) at analysis size.
// - Subject: a salient-object network (U²-Netp) finds where the subject is; SAM (MobileSAM),
//   prompted with each salient region's box and centre, draws its outline. Both must agree for a
//   confident result.
// - Object: SAM from points the user placed (positive and negative).
// Every result says how confident it is, from the models' own scores and their agreement:
// a doubtful selection is reported as such, never presented as accurate.

export const ANALYSIS_EDGE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The analysis size of a photo of `width` × `height`: the long edge at most ANALYSIS_EDGE. */
export function analysisSize(width, height, edge = ANALYSIS_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Resamples RGBA pixels to `width` × `height` by averaging the source pixels each target pixel
 * covers (box filter; bilinear when enlarging). Returns RGB floats 0–1, interleaved.
 */
export function resampleRgb(image, width, height) {
  const { width: sw, height: sh, data } = image;
  const out = new Float32Array(width * height * 3);
  const fx = sw / width;
  const fy = sh / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = y * fy;
    const y1 = Math.max(y0 + 1e-6, (y + 1) * fy);
    for (let x = 0; x < width; x += 1) {
      const x0 = x * fx;
      const x1 = Math.max(x0 + 1e-6, (x + 1) * fx);
      let r = 0; let g = 0; let b = 0; let weight = 0;
      if (fx <= 1 && fy <= 1) {
        // Enlarging: bilinear at the target pixel's centre.
        const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
        const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
        const ix = Math.floor(sx); const iy = Math.floor(sy);
        const tx = sx - ix; const ty = sy - iy;
        const jx = Math.min(sw - 1, ix + 1); const jy = Math.min(sh - 1, iy + 1);
        for (const [px, py, w] of [[ix, iy, (1 - tx) * (1 - ty)], [jx, iy, tx * (1 - ty)], [ix, jy, (1 - tx) * ty], [jx, jy, tx * ty]]) {
          const i = (py * sw + px) * 4;
          r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; weight += w;
        }
      } else {
        for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy += 1) {
          const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
          for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx += 1) {
            const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
            const i = (sy * sw + sx) * 4;
            r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; weight += w;
          }
        }
      }
      const o = (y * width + x) * 3;
      out[o] = r / weight / 255; out[o + 1] = g / weight / 255; out[o + 2] = b / weight / 255;
    }
  }
  return out;
}

/** An RGBA image at `width` × `height` (box-filtered) for the analysis. */
export function resampleRgba(image, width, height) {
  const rgb = resampleRgb(image, width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    data[o] = Math.round(rgb[i] * 255); data[o + 1] = Math.round(rgb[i + 1] * 255); data[o + 2] = Math.round(rgb[i + 2] * 255); data[o + 3] = 255;
  }
  return { width, height, data };
}

/**
 * A 1 × 3 × size × size ImageNet-normalised tensor of the image squashed to `size` (U²-Net).
 * `stretch` divides by the brightest channel value first, as U²-Net's own preprocessing does.
 */
export function squareTensor(image, size, { stretch = false } = {}) {
  const rgb = resampleRgb(image, size, size);
  let max = 1;
  if (stretch) { max = 0; for (let i = 0; i < rgb.length; i += 1) if (rgb[i] > max) max = rgb[i]; max = max || 1; }
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) out[c * n + i] = (rgb[i * 3 + c] / max - MEAN[c]) / STD[c];
  }
  return out;
}

/**
 * MobileSAM's encoder input: the photo with its long edge at 1024 px, RGB 0–255 floats, H × W × 3
 * (the exported encoder normalises and pads itself). `scale` maps image to model coordinates.
 */
export function samInput(image) {
  const scale = 1024 / Math.max(image.width, image.height);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const rgb = resampleRgb(image, width, height);
  for (let i = 0; i < rgb.length; i += 1) rgb[i] *= 255;
  return { tensor: rgb, scale, width, height };
}

/** Bilinear resize of a single-channel float map (sample centres aligned). */
export function resizeMap(map, sw, sh, width, height) {
  const out = new Float32Array(width * height);
  const fx = sw / width;
  const fy = sh / height;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const iy = Math.floor(sy); const jy = Math.min(sh - 1, iy + 1); const ty = sy - iy;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const ix = Math.floor(sx); const jx = Math.min(sw - 1, ix + 1); const tx = sx - ix;
      const top = map[iy * sw + ix] * (1 - tx) + map[iy * sw + jx] * tx;
      const bottom = map[jy * sw + ix] * (1 - tx) + map[jy * sw + jx] * tx;
      out[y * width + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Mean over a (2r + 1)² window (clamped at the borders), by running sums. */
export function boxMean(src, width, height, r) {
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / (2 * r + 1);
      sum += src[row + Math.min(width - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / (2 * r + 1);
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

/** Luminance (0–1) of RGBA pixels. */
export function luminance(image) {
  const { data } = image;
  const out = new Float32Array(image.width * image.height);
  for (let i = 0, o = 0; o < out.length; i += 4, o += 1) out[o] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  return out;
}

/**
 * Guided filter (He, Sun and Tang 2010) with a grey guide: the output follows `p` but takes its
 * edges from the guide, so a coarse mask snaps to the photo's own boundaries.
 */
export function guidedFilter(guide, p, width, height, r, eps) {
  const n = width * height;
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { ip[i] = guide[i] * p[i]; ii[i] = guide[i] * guide[i]; }
  const mI = boxMean(guide, width, height, r);
  const mp = boxMean(p, width, height, r);
  const mIp = boxMean(ip, width, height, r);
  const mII = boxMean(ii, width, height, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const cov = mIp[i] - mI[i] * mp[i];
    const variance = mII[i] - mI[i] * mI[i];
    a[i] = cov / (variance + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxMean(a, width, height, r);
  const mb = boxMean(b, width, height, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.min(1, Math.max(0, ma[i] * guide[i] + mb[i]));
  return out;
}

/**
 * 8-connected components of `mask` (Uint8, nonzero = set). Returns labels (0 = background) and,
 * per label, its area, bounding box, centroid and the largest value of `score` inside it.
 */
export function components(mask, width, height, score = null) {
  const labels = new Int32Array(width * height);
  const stats = [null];
  const stack = new Int32Array(width * height);
  let next = 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (!mask[start] || labels[start]) continue; // eslint-disable-line no-continue
    next += 1;
    const s = { label: next, area: 0, x0: width, y0: height, x1: 0, y1: 0, sx: 0, sy: 0, peak: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    while (top) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      s.area += 1; s.sx += x; s.sy += y;
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
      if (score && score[i] > s.peak) s.peak = score[i];
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue; // eslint-disable-line no-continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue; // eslint-disable-line no-continue
          const j = ny * width + nx;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[top++] = j; }
        }
      }
    }
    s.cx = s.sx / s.area; s.cy = s.sy / s.area;
    stats.push(s);
  }
  return { labels, stats };
}

/** Pixels within `r` (square) of a set pixel, as a Uint8 mask. */
export function dilate(mask, width, height, r) {
  const f = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) f[i] = mask[i] ? 1 : 0;
  const m = boxMean(f, width, height, r);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) out[i] = m[i] > 1e-6 ? 1 : 0;
  return out;
}

/** Fraction of a coverage map that is neither clearly in nor out (0.2–0.8) within its extent. */
function uncertainty(prob, region) {
  let unsure = 0; let total = 0;
  for (let i = 0; i < prob.length; i += 1) {
    if (!region[i]) continue; // eslint-disable-line no-continue
    total += 1;
    if (prob[i] > 0.2 && prob[i] < 0.8) unsure += 1;
  }
  return total ? unsure / total : 1;
}

/**
 * Refines a coarse coverage against the analysis image. Within `band` px of the coarse edge each
 * pixel is compared with the average colours of the confidently inside and outside pixels around
 * it (a local colour model, as simple matting does): its coverage is how much closer it is to the
 * inside colour, so the edge moves onto the photo's own edge and mixed pixels (branches against a
 * sky) get partial coverage. A small guided filter then removes pixel noise. Away from the edge
 * coverage is 0 or 1, so nothing is created in unrelated areas.
 */
export function refineEdges(coarse, image, { band = 6 } = {}) {
  const { width, height, data } = image;
  const n = width * height;
  const inside = new Uint8Array(n);
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) { inside[i] = coarse[i] >= 0.5 ? 1 : 0; outside[i] = 1 - inside[i]; }
  const nearIn = dilate(inside, width, height, band);
  const nearOut = dilate(outside, width, height, band);
  // Colour sums of the confident pixels (outside the band) on each side, per channel.
  const reach = band * 2;
  const sides = [inside, outside].map((side) => {
    const weight = new Float32Array(n);
    const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i += 1) {
      if (!side[i] || (nearIn[i] && nearOut[i])) continue; // eslint-disable-line no-continue
      weight[i] = 1;
      for (let c = 0; c < 3; c += 1) channels[c][i] = data[i * 4 + c] / 255;
    }
    return { weight: boxMean(weight, width, height, reach), channels: channels.map((ch) => boxMean(ch, width, height, reach)) };
  });
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!(nearIn[i] && nearOut[i])) { alpha[i] = inside[i]; continue; } // eslint-disable-line no-continue
    const [win, wout] = [sides[0].weight[i], sides[1].weight[i]];
    if (win < 1e-6 || wout < 1e-6) { alpha[i] = coarse[i]; continue; } // eslint-disable-line no-continue
    let dIn = 0; let dOut = 0;
    for (let c = 0; c < 3; c += 1) {
      const v = data[i * 4 + c] / 255;
      dIn += (v - sides[0].channels[c][i] / win) ** 2;
      dOut += (v - sides[1].channels[c][i] / wout) ** 2;
    }
    dIn = Math.sqrt(dIn); dOut = Math.sqrt(dOut);
    // Where the two sides look alike the colours say nothing: keep the model's own answer.
    alpha[i] = dIn + dOut < 0.04 ? coarse[i] : dOut / (dIn + dOut);
  }
  const smooth = guidedFilter(luminance(image), alpha, width, height, 1, 1e-3);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = nearIn[i] && nearOut[i] ? smooth[i] : inside[i];
    out[i] = v < 0.02 ? 0 : v > 0.98 ? 1 : v;
  }
  return out;
}

/**
 * Sky from the sky network's 320 × 320 probability. Regions under 0.2 % of the photo, or never
 * above 0.95, are dropped (the network's stray guesses: a lit window, a reflection).
 * :returns: { coverage (Float32, image size), found, confidence (0–1), area, regions, note }
 */
export function skyFromProbability(prob, size, image) {
  const { width, height } = image;
  const p = resizeMap(prob, size, size, width, height);
  const hard = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i += 1) hard[i] = p[i] > 0.5 ? 1 : 0;
  const { labels, stats } = components(hard, width, height, p);
  const keep = new Set(stats.filter((s) => s && s.area >= 0.002 * width * height && s.peak >= 0.95).map((s) => s.label));
  if (!keep.size) return { coverage: new Float32Array(p.length), found: false, confidence: 0, area: 0, regions: 0, note: 'No sky was found in this photo.' };
  const near = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i += 1) near[i] = keep.has(labels[i]) ? 1 : 0;
  const reach = dilate(near, width, height, 8);
  const coarse = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 1) coarse[i] = reach[i] ? p[i] : 0;
  const coverage = refineEdges(coarse, image);
  const region = dilate(near, width, height, 2);
  const unsure = uncertainty(p, region);
  let area = 0;
  for (let i = 0; i < coverage.length; i += 1) area += coverage[i];
  const confidence = Math.max(0, Math.min(1, 1 - unsure * 3));
  return {
    coverage, found: true, confidence, area: area / coverage.length, regions: keep.size,
    note: confidence < 0.7 ? 'Parts of this sky are uncertain: check its edges before adjusting strongly.' : null,
  };
}

/** The salient regions to prompt SAM with: boxes and centres in analysis pixels. */
export function salientRegions(saliency, size, image) {
  const { width, height } = image;
  const raw = resizeMap(saliency, size, size, width, height);
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < raw.length; i += 1) { if (raw[i] < lo) lo = raw[i]; if (raw[i] > hi) hi = raw[i]; }
  const span = hi - lo || 1;
  const s = new Float32Array(raw.length);
  const hard = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) { s[i] = (raw[i] - lo) / span; hard[i] = s[i] > 0.5 ? 1 : 0; }
  const { labels, stats } = components(hard, width, height, s);
  const found = stats.filter(Boolean);
  if (!found.length) return { regions: [], saliency: s, labels };
  const biggest = Math.max(...found.map((r) => r.area));
  const regions = found.filter((r) => r.area >= Math.max(0.2 * biggest, 0.002 * width * height)).sort((a, b) => b.area - a.area).slice(0, 4);
  return { regions, saliency: s, labels };
}

/** SAM prompt points for a salient region: its box (labels 2 and 3) and centre (1). */
export const regionPrompt = (r) => ({ points: [[r.x0, r.y0], [r.x1 + 1, r.y1 + 1], [r.cx, r.cy]], labels: [2, 3, 1] });

/** SAM's mask logits at the analysis size (the decoder resizes to it) → probability. */
export function samCoverage(logits) {
  const p = new Float32Array(logits.length);
  for (let i = 0; i < p.length; i += 1) p[i] = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logits[i]))));
  return p;
}

/** Intersection over union of two coverages thresholded at 0.5 (`b` may be a 0/1 Uint8 mask). */
export function iou(a, b) {
  let inter = 0; let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] >= 0.5; const y = b[i] >= 0.5;
    if (x && y) inter += 1;
    if (x || y) union += 1;
  }
  return union ? inter / union : 1;
}

/**
 * Subject from SAM's masks for each salient region: their union, refined. Confidence is the
 * lowest of SAM's predicted quality and its agreement with the salient region it was given.
 * :param parts: [{ coverage, score, region }]
 */
export function subjectFromParts(parts, regionMasks, image) {
  const n = image.width * image.height;
  if (!parts.length) return { coverage: new Float32Array(n), found: false, confidence: 0, area: 0, regions: 0, note: 'No clear subject was found. Try Select Object and tap the subject.' };
  const coarse = new Float32Array(n);
  let confidence = 1;
  parts.forEach(({ coverage, score }, k) => {
    for (let i = 0; i < n; i += 1) if (coverage[i] > coarse[i]) coarse[i] = coverage[i];
    confidence = Math.min(confidence, score, Math.min(1, iou(coverage, regionMasks[k]) / 0.75));
  });
  const coverage = refineEdges(coarse, image, { band: 4 });
  let area = 0;
  for (let i = 0; i < n; i += 1) area += coverage[i];
  const note = confidence < 0.6 ? 'This subject is uncertain: the selection may miss parts or include background. Refine it with Add and Subtract, or use Select Object.' : null;
  return { coverage, found: area > 0.001 * n, confidence: Math.max(0, confidence), area: area / n, regions: parts.length, note };
}

// ---- Compact coverage encoding (saved in edit documents) ----
// A coverage grid is quantised to 8 bits and run-length coded: pairs of (run length as a
// LEB128 varint, value). Masks are mostly 0 and 255 with a thin soft edge, so a 1024 px mask is
// typically tens of kilobytes; the bytes are stored as base64.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i += 1) B64_INDEX[B64.charCodeAt(i)] = i;

export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

/** Bytes from base64, or null when it is not valid base64. */
export function fromBase64(text) {
  if (typeof text !== 'string' || text.length % 4) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  for (let i = 0, o = 0; i < text.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (text[i + k] === '=' ? 0 : B64_INDEX[text.charCodeAt(i + k)] ?? -1));
    if (v.some((x) => x < 0) || (text[i] === '=' || text[i + 1] === '=')) return null;
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** 8-bit codes of a 0–1 coverage. */
export function quantize(coverage) {
  const out = new Uint8Array(coverage.length);
  for (let i = 0; i < coverage.length; i += 1) out[i] = Math.round(Math.min(1, Math.max(0, coverage[i])) * 255);
  return out;
}

export function encodeCodes(codes) {
  const bytes = [];
  for (let i = 0; i < codes.length;) {
    const value = codes[i];
    let run = 1;
    while (i + run < codes.length && codes[i + run] === value) run += 1;
    let n = run;
    while (n >= 128) { bytes.push((n & 127) | 128); n >>>= 7; }
    bytes.push(n, value);
    i += run;
  }
  return toBase64(Uint8Array.from(bytes));
}

/** Codes from encodeCodes() for a grid of `count` cells, or null when the data does not fit it. */
export function decodeCodes(text, count) {
  const bytes = fromBase64(text);
  if (!bytes) return null;
  const out = new Uint8Array(count);
  let o = 0;
  for (let i = 0; i < bytes.length;) {
    let run = 0; let shift = 0;
    while (i < bytes.length && bytes[i] & 128) { run |= (bytes[i] & 127) << shift; shift += 7; i += 1; if (shift > 28) return null; }
    if (i + 1 >= bytes.length) return null;
    run |= bytes[i] << shift;
    const value = bytes[i + 1];
    i += 2;
    if (!run || o + run > count) return null;
    out.fill(value, o, o + run);
    o += run;
  }
  return o === count ? out : null;
}
