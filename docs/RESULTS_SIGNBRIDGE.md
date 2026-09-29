# SignBridge handshape engine: smoothing and scale (2026-09-29)

**Synthetic hands only.** `scripts/bench-signbridge.mjs` builds the 20 signs
geometrically and adds seeded Gaussian landmark noise and dropped frames. It
measures stability and scale handling. It does **not** measure accuracy on
real signers, which has not been measured.

## What changed
1. **Palm-scaled thresholds** (`signbridgeEngine.js`). Pinch, cluster and gap
   distances, and the two-hand distances, are measured in palm lengths
   (wrist to middle knuckle, reference 0.11 of the frame) instead of raw
   image units. A pinch stays a pinch when the hand is nearer or further
   from the camera. At the reference size the rules behave exactly as before.
2. **Tracker** (`signbridgeTracker.js`), used by the live translator, "Try it"
   in My signs, and recorded-video subtitles, on the website and in the app:
   - One Euro filter on every landmark (strong smoothing when still, little
     lag when moving);
   - a confidence-weighted vote over the last 7 frames with hysteresis: a new
     sign needs a 50% majority, the held sign survives until it falls below
     30%, and one dropped frame no longer ends a held sign;
   - speaks after 7 frames of the steady result (was 9 raw frames).

## Results (seeded; `node scripts/bench-signbridge.mjs`)

Signs recognised (of 20) by hand size in the frame:

| hand size        | x0.6 | x0.8 | x1 | x1.25 | x1.6 |
|------------------|-----:|-----:|---:|------:|-----:|
| before           | 18   | 19   | 20 | 18    | 17   |
| after            | 19   | 20   | 20 | 20    | 19   |

The one remaining miss (DOCTOR at x0.6 and x1.6) comes from the test, not
the engine: each hand is scaled around its own wrist, so the index finger no
longer reaches the other wrist. A real person moving nearer scales both
hands together.

Each sign held 45 frames, 5% of frames with no hands detected:

| noise (sigma) | path   | frame accuracy | output changes per sign | spoken right | spoken wrong | missed |
|--------------:|--------|---------------:|------------------------:|-------------:|-------------:|-------:|
| 0.002 | before | 0.95  | 6.2  | 20 | 0 | 0 |
| 0.002 | after  | 1.00  | 2.0  | 20 | 0 | 0 |
| 0.004 | before | 0.93  | 7.8  | 20 | 0 | 0 |
| 0.004 | after  | 1.00  | 2.0  | 20 | 0 | 0 |
| 0.006 | before | 0.90  | 9.3  | 19 | 0 | 1 |
| 0.006 | after  | 0.99  | 2.05 | 20 | 0 | 0 |
| 0.008 | before | 0.89  | 9.9  | 18 | 0 | 2 |
| 0.008 | after  | 0.99  | 2.05 | 20 | 0 | 0 |

"Output changes per sign": 2 is ideal (the sign appears, then goes when the
hands drop). Before, the chip flickered 6 to 10 times while one sign was held.

Cost: a sign is first shown about 2 to 3 frames (70 to 100 ms) later than
before, and is spoken about 330 ms after it starts (was about 300 ms, but
often never, because one bad frame reset the count).

Locked in by `scripts/test-signbridge-tracker.mjs` (part of `npm test`).
