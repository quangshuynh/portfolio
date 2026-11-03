// The segmentation models behind intelligent selections (Interval 23). They are served from this
// site (public/photography/editor-models/), fetched only when a selection tool is first used, kept
// by the browser's HTTP cache, and checked against their SHA-256 before use. Photos never leave the
// device: models run in a worker with onnxruntime-web (WebAssembly, one thread). Licences and
// provenance are in public/photography/third-party-notices.txt.

export const MODEL_DIR = 'photography/editor-models/';

export const MODELS = Object.freeze({
  // Sky segmentation (U²-Net trained for sky; MIT, github.com/xiongzhu666/Sky-Segmentation-and-
  // Post-processing), weights quantised to 8 bits here (onnxruntime 1.29 quantize_dynamic, QUInt8)
  // from skyseg.onnx (SHA-256 ab9c34c6…). Sky IoU against the original on 83 photos: median 0.998.
  sky: Object.freeze({ file: 'sky-u2net-int8-a1a5aa06.onnx', sha256: 'a1a5aa061d2235f4e35438684a18524b3cb287c54aba3ab484108f8974fe8ce7', bytes: 44_211_764, size: 320 }),
  // Salient object detection (U²-Netp; Apache-2.0, github.com/xuebinqin/U-2-Net), as rembg ships it.
  saliency: Object.freeze({ file: 'u2netp-309c8469.onnx', sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8', bytes: 4_574_861, size: 320 }),
  // Segment Anything with a small image encoder (MobileSAM; Apache-2.0, github.com/ChaoningZhang/
  // MobileSAM; ONNX export: huggingface.co/Acly/MobileSAM, MIT): the encoder once per photo, then the
  // prompt decoder per selection. Kept at 32-bit floats: 8-bit weights changed some outlines
  // (IoU 0.54 against the original). Chosen over SlimSAM-77, whose encoder peaked at 1.7 GB.
  samEncoder: Object.freeze({ file: 'mobilesam-encoder-580f5fb6.onnx', sha256: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749', bytes: 28_157_093 }),
  samDecoder: Object.freeze({ file: 'mobilesam-decoder-8976b90a.onnx', sha256: '8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe', bytes: 16_496_559 }),
});

/** What each selection kind needs, and the algorithm version recorded with its masks. */
export const SELECTION_KINDS = Object.freeze({
  sky: Object.freeze({ models: ['sky'], version: 'sky-u2net-int8/1' }),
  subject: Object.freeze({ models: ['saliency', 'samEncoder', 'samDecoder'], version: 'u2netp+mobilesam/1' }),
  background: Object.freeze({ models: ['saliency', 'samEncoder', 'samDecoder'], version: 'u2netp+mobilesam/1' }),
  object: Object.freeze({ models: ['samEncoder', 'samDecoder'], version: 'mobilesam/1' }),
});

/** Bytes a selection kind still has to download, given the models already loaded. */
export const downloadBytes = (kind, loaded = new Set()) => SELECTION_KINDS[kind].models.filter((name) => !loaded.has(name)).reduce((sum, name) => sum + MODELS[name].bytes, 0);
