/**
 * Recognition model registry: every sign-recognition model the app can run.
 *
 * One entry per model. The UI (Settings > Recognition), the offline
 * preparation, and the engine manager all read this list, so adding a model
 * is adding an entry plus (for a new runtime) an engine adapter in
 * src/services/engines/.
 *
 * Accuracy is only ever a MEASURED figure with what it was measured on, or
 * explicitly "not measured". Licences distinguish code, weights and training
 * data, because a permissive code licence says nothing about the weights.
 *
 * Fields
 *   id, name            stable id (persisted in settings) and display name
 *   language            'ISL' | 'ASL'
 *   kind                'sign tagger' | 'isolated signs' | 'fingerspelling'
 *                       | 'handshape rules' | 'glove'
 *   runtime             'onnx' | 'tflite' | 'js'
 *   engine              adapter in src/services/engines/ that runs it
 *   input               landmarks used, frame count, stride, normalisation
 *   decode              how outputs become words
 *   vocabUrl            label list, or null
 *   files               [{url, bytes, role}] that must be downloaded
 *   licence             {code, weights, data, commercial, attribution}
 *   sourceUrl           where it comes from
 *   accuracy            {summary, metrics, measuredOn, date} or {summary: 'not measured'}
 *   default             the model used when nothing is chosen or a load fails
 */

/** onnxruntime-web's wasm binary: shared by every ONNX model, counted once. */
// Its file name is content-hashed at build time, so it is matched by pattern.
export const ORT_WASM = {
  match: /ort-wasm.*\.wasm$/, bytes: 27_797_172, role: 'runtime (shared)',
};

export const MODELS = [
  {
    id: 'isl-aangika-v2',
    version: 2,
    name: 'Aangika ISL tagger v2',
    language: 'ISL',
    kind: 'sign tagger',
    runtime: 'onnx',
    engine: 'aangika',
    input: {
      landmarks: ['pose 33', 'left hand 21', 'right hand 21'],
      features: 225,
      frames: 40,
      stride: 20,
      fps: 25,
      normalisation: 'bodyNormalise: shoulder-midpoint centre, 2-D shoulder span scale, missing = 0',
    },
    decode: 'sigmoid, max over time per word, threshold 0.15 + top-8, ordered by peak frame',
    vocabUrl: '/models/vocab.json',
    vocabSize: 1500,
    files: [
      { url: '/models/sanketvani_word_tagger_v2.onnx', bytes: 21_391_045, role: 'weights' },
      { url: '/models/vocab.json', bytes: 28_702, role: 'vocabulary' },
    ],
    sharedFiles: ['ort-wasm'],
    licence: {
      code: 'this repository',
      weights: 'derived from iSign: CC BY-NC-SA 4.0',
      data: 'iSign v1.1 (Exploration-Lab), CC BY-NC-SA 4.0: research only, not commercial',
      commercial: false,
      attribution: 'iSign, Exploration-Lab, IIT Kanpur',
    },
    sourceUrl: 'https://huggingface.co/datasets/Exploration-Lab/iSign',
    accuracy: {
      summary: 'Live windows, 996 never-seen news clips: precision 0.44, recall 0.22',
      metrics: { mAP: 0.298, precision: 0.442, recall: 0.217, wordsPerClip: 1.79 },
      measuredOn: '996 iSign clips absent from its training data (docs/RESULTS_v2.md)',
      date: '2026-09-28',
    },
    default: true,
  },
  {
    id: 'isl-signbridge',
    version: 1,
    name: 'SignBridge + My signs',
    language: 'ISL',
    kind: 'handshape rules',
    runtime: 'js',
    engine: 'signbridge',
    input: {
      landmarks: ['hands 21 each', 'pose (optional, for location)'],
      frames: 1,
      normalisation: 'wrist-relative, scaled by max wrist distance (extractHandFeature)',
    },
    decode: '20 built-in geometric rules + your taught handshapes (k-NN), per frame; held for 9 frames',
    vocabUrl: null,
    vocabSize: 20,
    files: [],
    sharedFiles: [],
    licence: {
      code: 'this repository (feature idea ported from github.com/dhairyakumar018/SIGNBRIDGE)',
      weights: 'none: rules and your own samples',
      data: 'none',
      commercial: true,
      attribution: 'SignBridge normalisation',
    },
    sourceUrl: 'https://github.com/dhairyakumar018/SIGNBRIDGE',
    accuracy: {
      summary: 'Not measured on real hands (20/20 on synthetic geometry tests only)',
      metrics: null,
      measuredOn: 'scripts/test-signbridge.mjs synthetic hands',
      date: '2026-09-28',
    },
    default: false,
  },
];

MODELS.push({
  id: 'asl-islr-250',
  version: 1,
  name: 'ASL isolated signs (250)',
  language: 'ASL',
  kind: 'isolated signs',
  runtime: 'onnx',
  engine: 'asl-islr',
  input: {
    landmarks: ['face 468 (lips used)', 'left hand 21', 'pose 33', 'right hand 21'],
    features: 543 * 3,
    frames: 30,
    stride: 10,
    normalisation: 'none outside the model: raw MediaPipe coordinates, NaN = missing; the graph normalises',
    needsFace: true,
  },
  decode: 'softmax over 250 signs on a 30-frame window; top-1 if p >= 0.5 and hands in >= 30% of frames',
  decodeParams: { threshold: 0.5 },
  vocabUrl: '/models/asl/islr-1st/vocab.json',
  vocabSize: 250,
  files: [
    { url: '/models/asl/islr-1st/model.onnx', bytes: 22_187_818, role: 'weights' },
    { url: '/models/asl/islr-1st/vocab.json', bytes: 3_761, role: 'vocabulary' },
  ],
  sharedFiles: ['ort-wasm'],
  extraDownloads: [{ what: 'MediaPipe face landmarker', bytes: 3_758_596 }],
  licence: {
    code: 'MIT (Kaggle ISLR 1st place, Hoyeol Sohn)',
    weights: 'MIT (huggingface.co/sign/kaggle-asl-signs-1st-place)',
    data: 'PopSign ASL v1.0 (Georgia Tech), CC BY 4.0',
    commercial: true,
    attribution: 'Hoyeol Sohn (ISLR 1st place); PopSign ASL v1.0, Georgia Tech / Google',
  },
  sourceUrl: 'https://huggingface.co/sign/kaggle-asl-signs-1st-place',
  accuracy: {
    summary: 'Not measured in this app yet. Reported on Kaggle held-out data (MediaPipe Holistic landmarks), not re-verified here.',
    metrics: null,
    measuredOn: 'n/a: needs the Kaggle ISLR data (account required); see docs/ASL_MODELS.md',
    date: '2026-09-29',
  },
  default: true,
});

export const SIGN_LANGUAGES = ['ISL', 'ASL'];

export const getModel = (id) => MODELS.find((m) => m.id === id) || null;
export const modelsFor = (language) => MODELS.filter((m) => m.language === language);
export const defaultModel = (language = 'ISL') =>
  MODELS.find((m) => m.language === language && m.default)
  || modelsFor(language)[0]
  || MODELS.find((m) => m.default);

/** Total download for a model, counting the shared runtime once. */
export function downloadBytes(model) {
  const own = (model.files || []).reduce((s, f) => s + (f.bytes || 0), 0);
  const extra = (model.extraDownloads || []).reduce((s, f) => s + (f.bytes || 0), 0);
  return own + extra + (model.sharedFiles?.includes('ort-wasm') ? ORT_WASM.bytes : 0);
}

export const REQUIRED_FIELDS = [
  'id', 'name', 'language', 'kind', 'runtime', 'engine', 'input', 'decode',
  'files', 'licence', 'sourceUrl', 'accuracy',
];

export default { MODELS, ORT_WASM, SIGN_LANGUAGES, getModel, modelsFor, defaultModel, downloadBytes };
