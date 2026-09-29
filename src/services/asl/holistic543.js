/**
 * Landmarks -> the 543-point MediaPipe Holistic layout the Kaggle ASL models
 * (Google "Isolated Sign Language Recognition") were trained on.
 *
 * Row order, exactly as in the competition data (type, landmark_index):
 *     0..467    face        (Holistic face mesh; Tasks FaceLandmarker's first
 *                            468 of 478 points are the same mesh, irises after)
 *   468..488    left_hand   21
 *   489..521    pose        33
 *   522..542    right_hand  21
 * Each row is (x, y, z) in MediaPipe normalised image coordinates.
 * A missing part is NaN, as in the competition parquet files: the model's
 * own preprocessing (inside the TFLite/ONNX graph) masks NaNs itself.
 *
 * Left/right follow the same rule as the ISL packFrame: MediaPipe's label,
 * swapped when the frame is mirrored, so "left" is the signer's left hand.
 */

export const N_LANDMARKS = 543;
export const FACE_START = 0;
export const FACE_COUNT = 468;
export const LEFT_START = 468;
export const POSE_START = 489;
export const RIGHT_START = 522;
export const HAND_COUNT = 21;
export const POSE_COUNT = 33;

function put(out, start, points, count) {
  if (!points) return;
  const n = Math.min(count, points.length);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const o = (start + i) * 3;
    out[o] = Number.isFinite(p?.x) ? p.x : NaN;
    out[o + 1] = Number.isFinite(p?.y) ? p.y : NaN;
    out[o + 2] = Number.isFinite(p?.z) ? p.z : NaN;
  }
}

/**
 * @param {{pose?, hands?, face?}} result  landmarker.detect() output
 * @param {boolean} mirrored              same meaning as packFrame's
 * @returns {Float32Array} 543*3 floats, NaN where nothing was detected
 */
export function packHolistic543(result, mirrored = false) {
  const out = new Float32Array(N_LANDMARKS * 3).fill(NaN);
  put(out, FACE_START, result?.face, FACE_COUNT);
  put(out, POSE_START, result?.pose, POSE_COUNT);
  for (const hand of result?.hands || []) {
    const label = String(hand?.handedness || '').toLowerCase();
    let isLeft;
    if (label === 'left') isLeft = !mirrored;
    else if (label === 'right') isLeft = mirrored;
    else continue;
    put(out, isLeft ? LEFT_START : RIGHT_START, hand.landmarks, HAND_COUNT);
  }
  return out;
}

/** True when at least one hand has a finite wrist in this packed frame. */
export function hasHand(frame) {
  return Number.isFinite(frame[LEFT_START * 3]) || Number.isFinite(frame[RIGHT_START * 3]);
}

export default { packHolistic543, hasHand, N_LANDMARKS };
