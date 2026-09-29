/**
 * Simulated glove, for tests and development without hardware.
 *
 * Installed ONLY when the page URL contains ?glove=sim. Exposes
 * window.__aangikaGloveSim with:
 *   connect(frames, {hz, loop})  replay recorded frames as a connected glove
 *   importSigns(json)             load glove signs (an Aangika sign export)
 * Real recognition runs on the replayed frames; nothing is scripted.
 */

import glove from './glove.js';
import { replayTransport } from './transports.js';
import { encodeFrame } from './protocol.js';
import { importJSON, init } from '../customSigns.js';

export function installGloveSim() {
  if (typeof window === 'undefined') return;
  if (!new URLSearchParams(window.location.search).has('glove')) return;
  window.__aangikaGloveSim = {
    async connect(frames, opts = {}) {
      const bytes = frames.map((f) => (Array.isArray(f) ? Uint8Array.from(f) : encodeFrame(f, { extended: true })));
      await glove.connect(replayTransport(bytes, opts));
      return bytes.length;
    },
    async importSigns(json) {
      await init();
      return importJSON(json);
    },
  };
}

export default { installGloveSim };
