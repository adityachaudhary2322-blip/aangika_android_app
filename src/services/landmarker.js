/**
 * MediaPipe Tasks Vision -- pose and hand landmarks from the shared video.
 *
 * Two separate landmarkers, both in VIDEO mode, driven from one
 * requestAnimationFrame loop so a pose result and a hand result always describe
 * the same instant before they are packed together.
 *
 * Carried over from the ISL-FINAL audit and worth repeating: the ONNX tagger
 * was trained on MediaPipe **Holistic** (the legacy Solutions API); this uses
 * MediaPipe **Tasks**. Landmark indices line up -- pose 33 with shoulders at
 * 11/12, hands 21 with wrist at 0 -- so the 225-slot layout is preserved, but
 * whether accuracy survives the substitution has never been measured.
 */

import {
  FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker,
} from '@mediapipe/tasks-vision';
import { assetUrl, LOCAL_MEDIAPIPE } from './platform.js';

/** CDN on the website; the copy bundled in the APK in the Android app. */
const local = (url) => assetUrl(url, `${LOCAL_MEDIAPIPE.models}/${url.split('/').pop()}`);

// Model versions are pinned, not "latest": training/extract.py runs the same
// .task files (training/download_models.py) so training features match what
// the browser produces. Bump these only together with a retrain.
const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
/** Face mesh: only loaded when a recognition model reads lips (ASL ISLR). */
export const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let handLandmarker = null;
let poseLandmarker = null;
let faceLandmarker = null;
let faceLoading = null;
let fileset = null;
let loading = null;

/** Which delegate actually got used. GPU init can fail silently on mobile. */
export let activeDelegate = 'unknown';

export async function load(onProgress = () => {}) {
  if (handLandmarker && poseLandmarker) return true;
  if (loading) return loading;

  loading = (async () => {
    onProgress('Loading MediaPipe runtimeâ€¦');
    fileset = await FilesetResolver.forVisionTasks(assetUrl(WASM_BASE, LOCAL_MEDIAPIPE.wasm));

    // Both models are the float16 builds -- roughly half the weights of the
    // float32 ones and the variants MediaPipe ships for mobile.
    const build = async (delegate) => {
      onProgress(`Loading hand landmarker (${delegate})â€¦`);
      handLandmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: local(HAND_MODEL), delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      onProgress(`Loading pose landmarker (${delegate})â€¦`);
      poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: local(POSE_MODEL), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      activeDelegate = delegate;
    };

    // GPU first. On phones without a working WebGL path this throws, and
    // falling back to CPU beats failing outright -- but the UI is told which
    // one it got, because CPU is several times slower and that explains a low
    // frame rate that would otherwise look like a bug.
    try {
      await build('GPU');
    } catch (gpuError) {
      console.warn('[landmarker] GPU delegate unavailable, using CPU', gpuError);
      try { handLandmarker?.close(); } catch { /* not created */ }
      try { poseLandmarker?.close(); } catch { /* not created */ }
      handLandmarker = null;
      poseLandmarker = null;
      await build('CPU');
    }

    onProgress('Ready');
    return true;
  })().catch((err) => {
    loading = null;
    handLandmarker = null;
    poseLandmarker = null;
    throw err;
  });

  return loading;
}

export function isLoaded() {
  return Boolean(handLandmarker && poseLandmarker);
}

/**
 * Add the face mesh (468 points + irises) to every detect() call. Costs a
 * ~3.6 MB download and a third detector per frame, so it is loaded only for
 * models that need it and freed again with unloadFace().
 */
export async function loadFace(onProgress = () => {}) {
  if (faceLandmarker) return true;
  if (faceLoading) return faceLoading;
  faceLoading = (async () => {
    await load(onProgress);
    onProgress('Loading face landmarkerâ€¦');
    const make = (delegate) => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: local(FACE_MODEL), delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    try {
      faceLandmarker = await make(activeDelegate === 'CPU' ? 'CPU' : 'GPU');
    } catch {
      faceLandmarker = await make('CPU');
    }
    return true;
  })().finally(() => { faceLoading = null; });
  return faceLoading;
}

export function unloadFace() {
  try { faceLandmarker?.close(); } catch { /* already closed */ }
  faceLandmarker = null;
}

export const hasFace = () => Boolean(faceLandmarker);

export function getDelegate() {
  return activeDelegate;
}

/**
 * Detect on one video frame.
 *
 * MediaPipe rejects a timestamp that is not strictly increasing, and rAF can
 * deliver two callbacks inside the same millisecond, so the caller must pass a
 * monotonic value. Returns null when nothing could be read.
 */
export function detect(video, timestampMs) {
  if (!handLandmarker || !poseLandmarker) return null;
  if (!video || video.readyState < 2) return null;

  let pose = null;
  let hands = [];

  try {
    const poseResult = poseLandmarker.detectForVideo(video, timestampMs);
    if (poseResult?.landmarks?.length) pose = poseResult.landmarks[0];
  } catch {
    // Frame-timing jitter throws here; skipping one frame is harmless.
  }

  try {
    const handResult = handLandmarker.detectForVideo(video, timestampMs);
    if (handResult?.landmarks?.length) {
      hands = handResult.landmarks.map((landmarks, i) => ({
        landmarks,
        handedness: handResult.handedness?.[i]?.[0]?.categoryName || null,
      }));
    }
  } catch {
    // Same.
  }

  let face = null;
  if (faceLandmarker) {
    try {
      const faceResult = faceLandmarker.detectForVideo(video, timestampMs);
      if (faceResult?.faceLandmarks?.length) face = faceResult.faceLandmarks[0];
    } catch {
      // Same.
    }
  }

  return { pose, hands, face };
}

export function close() {
  try { handLandmarker?.close(); } catch { /* already closed */ }
  try { poseLandmarker?.close(); } catch { /* already closed */ }
  unloadFace();
  handLandmarker = null;
  poseLandmarker = null;
  loading = null;
}

/** MediaPipe's standard 21-point hand topology. */
export const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Upper body only -- legs never carry sign information. */
export const POSE_BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
];

export default {
  load, isLoaded, detect, close, getDelegate, HAND_BONES, POSE_BONES,
  loadFace, unloadFace, hasFace,
};
