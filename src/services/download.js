/**
 * fetch() with byte-level progress.
 *
 * Goes through the service worker like any fetch, so a model downloaded here
 * lands in the 'aangika-models' CacheFirst cache and loads offline next time.
 * Falls back to a plain arrayBuffer() when the body is not streamable.
 *
 * @param {string} url
 * @param {(loaded:number, total:number|null) => void} onBytes
 * @param {number|null} expectedBytes  used when the server sends no Content-Length
 * @returns {Promise<Uint8Array>}
 */
export async function fetchWithProgress(url, onBytes = () => {}, expectedBytes = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || expectedBytes || null;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export const formatMB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default { fetchWithProgress, formatMB };
