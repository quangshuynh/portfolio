// The segmentation models behind intelligent selections (Interval 23). They are served from this
// site (public/photography/editor-models/), fetched only when a selection tool is first used, kept
// by the browser's HTTP cache, and checked against their SHA-256 before use. Photos never leave the
// device: models run in a worker with onnxruntime-web (WebAssembly, one thread). Licences and
// provenance are in public/photography/third-party-notices.txt.

export const MODEL_DIR = 'photography/editor-models/';

// FP16 WEIGHTS (Interval 23.1): weights of 1024+ values are stored as 16-bit floats with a Cast
// back to 32 bits that onnxruntime folds when the session is created, so the networks compute as
// before at about half the download. Every SAM mask on the benchmark kept IoU ≥ 0.998 with the
// originals. The sky model stays 8-bit (smaller still).
export const MODELS = Object.freeze({
  // Sky segmentation (U²-Net trained for sky; MIT, github.com/xiongzhu666/Sky-Segmentation-and-
  // Post-processing), weights quantised to 8 bits here (onnxruntime 1.29 quantize_dynamic, QUInt8)
  // from skyseg.onnx (SHA-256 ab9c34c6…). Sky IoU against the original on 83 photos: median 0.998.
  sky: Object.freeze({ file: 'sky-u2net-int8-a1a5aa06.onnx', sha256: 'a1a5aa061d2235f4e35438684a18524b3cb287c54aba3ab484108f8974fe8ce7', bytes: 44_211_764, size: 320 }),
  // Salient object detection (U²-Netp; Apache-2.0, github.com/xuebinqin/U-2-Net), as rembg ships it
  // (u2netp.onnx, SHA-256 309c8469…), weights stored at 16 bits (see FP16 WEIGHTS below).
  saliency: Object.freeze({ file: 'u2netp-fp16w-381406e5.onnx', sha256: '381406e511d44f0c6cbf02df025a04198dde7272299acc05b6ee16bbba12aa96', bytes: 2_342_057, size: 320 }),
  // Segment Anything with a small image encoder (MobileSAM; Apache-2.0, github.com/ChaoningZhang/
  // MobileSAM; ONNX export: huggingface.co/Acly/MobileSAM, MIT): the encoder once per photo, then the
  // prompt decoder per selection (originals: encoder 580f5fb6…, decoder 8976b90a…). Computed at
  // 32-bit floats: 8-bit weights changed outlines (encoder IoU 0.54, decoder 0.10 on one mask).
  // Chosen over SlimSAM-77, whose encoder peaked at 1.7 GB.
  samEncoder: Object.freeze({ file: 'mobilesam-encoder-fp16w-dffca332.onnx', sha256: 'dffca3325b2aff8c9f2154a52cb237ab5e25b95c199d3d3a496f16335415d64b', bytes: 16_756_733 }),
  samDecoder: Object.freeze({ file: 'mobilesam-decoder-fp16w-e9b759e6.onnx', sha256: 'e9b759e673aac416456f74de62f6877c839f6d0dfe96a50ca5147764457ca5da', bytes: 8_405_058 }),
});

/** What each selection kind needs, and the algorithm version recorded with its masks. */
export const SELECTION_KINDS = Object.freeze({
  sky: Object.freeze({ models: ['sky'], version: 'sky-u2net-int8/2' }),
  subject: Object.freeze({ models: ['saliency', 'samEncoder', 'samDecoder'], version: 'u2netp+mobilesam/2' }),
  background: Object.freeze({ models: ['saliency', 'samEncoder', 'samDecoder'], version: 'u2netp+mobilesam/2' }),
  object: Object.freeze({ models: ['samEncoder', 'samDecoder'], version: 'mobilesam/2' }),
});

/** Bytes a selection kind still has to download, given the models already loaded. */
export const downloadBytes = (kind, loaded = new Set()) => SELECTION_KINDS[kind].models.filter((name) => !loaded.has(name)).reduce((sum, name) => sum + MODELS[name].bytes, 0);

/**
 * Below these confidences a selection is shown as doubtful, with its reasons. Confidence is a
 * heuristic from the models' own evidence (Interval 23.1), not a calibrated probability.
 */
export const WARN_BELOW = Object.freeze({ sky: 0.7, subject: 0.6, background: 0.6, object: 0.6 });
