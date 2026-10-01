/**
 * Who is signing, when more than one person is in view.
 *
 * The camera can see several people (a demo audience, someone walking past).
 * MediaPipe returns hands and bodies with no notion of whose hand is whose,
 * so a bystander's hand could take one of the two hand slots, or their body
 * could be used as "the signer's" body frame. This picks ONE person and keeps
 * only their hands:
 *
 *   - the signer is the person nearest the middle of the picture, bigger
 *     (closer) people counting more;
 *   - once chosen they are LOCKED: followed frame to frame even if they move
 *     off-centre; someone else is chosen only after they have been gone for
 *     a while (LOST_MS);
 *   - each hand belongs to the person whose wrist (or forearm) it is nearest
 *     to; only the signer's hands are kept (at most two);
 *   - with no body in view, the two hands nearest the middle are kept;
 *   - SWITCHING: anyone else who raises a hand above their head for RAISE_MS
 *     becomes the signer ("my turn"). A position check, not a sign: it cannot
 *     be triggered by a misread sign.
 *
 * Coordinates are MediaPipe's normalised image coordinates (0..1).
 */

const LEFT_SHOULDER = 11; const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13; const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15; const RIGHT_WRIST = 16;
const NOSE = 0;
const LOST_MS = 1200;            // locked person missing this long: choose again
const MATCH_SPANS = 1.2;         // same person if the shoulders moved less than this many shoulder widths
const REACH_SPANS = 2.2;         // a hand further than this from its owner's arm is nobody's (noise)
const RAISE_MS = 900;            // a hand held above the head this long: "my turn"

const ok = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility === undefined || p.visibility > 0.3);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Centre and size of a person, from the shoulders (or the nose). */
function personOf(pose, index) {
  const l = pose[LEFT_SHOULDER]; const r = pose[RIGHT_SHOULDER];
  if (ok(l) && ok(r)) {
    const span = Math.max(0.02, dist(l, r));
    return { index, pose, cx: (l.x + r.x) / 2, cy: (l.y + r.y) / 2, span };
  }
  if (ok(pose[NOSE])) return { index, pose, cx: pose[NOSE].x, cy: pose[NOSE].y + 0.1, span: 0.12 };
  return null;
}

/** A wrist clearly above the head (above the nose by more than half a shoulder width). */
function handRaised(p) {
  const nose = p.pose[NOSE];
  if (!ok(nose)) return false;
  return [LEFT_WRIST, RIGHT_WRIST].some((i) => ok(p.pose[i]) && p.pose[i].y < nose.y - 0.5 * p.span);
}

/** How well a person fits "the one in the middle": higher is better. */
const centrality = (p) => p.span * 2 - Math.abs(p.cx - 0.5) - 0.5 * Math.abs(p.cy - 0.45);

/** Distance from a hand to a person's arm (wrist, elbow), in that person's shoulder widths. */
function handToPerson(hand, person) {
  const w = hand.landmarks?.[0];
  if (!w) return Infinity;
  const pts = [LEFT_WRIST, RIGHT_WRIST, LEFT_ELBOW, RIGHT_ELBOW].map((i) => person.pose[i]).filter(ok);
  if (!pts.length) return dist(w, { x: person.cx, y: person.cy }) / person.span;
  return Math.min(...pts.map((p) => dist(w, p))) / person.span;
}

export function createFocus() {
  let locked = null;            // { x, y, span, seenAt }
  let raising = null;           // { x, y, since }: someone else with a hand up
  let lastTs = -Infinity;
  let lastSource = null;

  function reset() { locked = null; raising = null; lastTs = -Infinity; }

  /**
   * @param poses   array of pose landmark arrays (one per person)
   * @param hands   [{ landmarks, handedness, world }]
   * @param ts      milliseconds (monotonic per source)
   * @param source  the video element (a new source starts afresh)
   * -> { pose, hands, people, ignoredHands }
   */
  function select({ poses = [], hands = [] }, ts, source = null) {
    if (source !== lastSource || ts < lastTs) { reset(); lastSource = source; }
    lastTs = ts;
    const people = poses.map(personOf).filter(Boolean);

    let focus = null;
    if (locked) {
      // The same person: nearest to where they were, within reach.
      let best = null;
      for (const p of people) {
        const d = dist({ x: p.cx, y: p.cy }, locked) / Math.max(locked.span, p.span);
        if (d < MATCH_SPANS && (!best || d < best.d)) best = { p, d };
      }
      if (best) focus = best.p;
      else if (ts - locked.seenAt < LOST_MS) focus = null;          // briefly lost: keep waiting for them
      else locked = null;
    }
    if (!locked && people.length) focus = people.reduce((a, b) => (centrality(b) > centrality(a) ? b : a));

    // "My turn": another person with a wrist above the top of their head.
    let switched = false;
    const up = people.find((p) => p !== focus && handRaised(p));
    if (up) {
      if (raising && dist({ x: up.cx, y: up.cy }, raising) / up.span < MATCH_SPANS) {
        if (ts - raising.since >= RAISE_MS) { focus = up; locked = null; raising = null; switched = true; }
      } else raising = { x: up.cx, y: up.cy, since: ts };
    } else raising = null;
    if (focus) locked = { x: focus.cx, y: focus.cy, span: focus.span, seenAt: ts };

    // Hands: each to its nearest person; keep the signer's.
    let kept;
    if (focus && people.length) {
      kept = hands
        .map((h) => {
          let owner = null; let d = Infinity;
          for (const p of people) { const x = handToPerson(h, p); if (x < d) { d = x; owner = p; } }
          return { h, owner, d };
        })
        .filter((x) => x.owner === focus && x.d <= REACH_SPANS)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map((x) => x.h);
    } else if (locked) {
      kept = [];                                                     // signer briefly lost: nobody else's hands
    } else {
      // No body in view: the two hands nearest the middle.
      kept = hands
        .map((h) => ({ h, d: h.landmarks?.[0] ? Math.abs(h.landmarks[0].x - 0.5) : 1 }))
        .sort((a, b) => a.d - b.d).slice(0, 2).map((x) => x.h);
    }

    return {
      pose: focus ? focus.pose : (poses.length === 1 && !locked ? poses[0] : null),
      hands: kept,
      people: people.length,
      ignoredHands: hands.length - kept.length,
      switched,
      raising: Boolean(raising),
    };
  }

  return { select, reset };
}

export default { createFocus };
