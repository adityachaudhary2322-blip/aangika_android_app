/**
 * Where PeerJS finds its signalling broker.
 *
 * Default: the free public PeerJS cloud (no settings). To self-host
 * (`npx peerjs --port 9000`), build with:
 *   VITE_PEER_HOST=peer.example.com VITE_PEER_PORT=443 VITE_PEER_PATH=/ VITE_PEER_SECURE=true
 * Only signalling goes through the broker; media flows peer to peer.
 */
export function peerServerOptions() {
  const env = import.meta.env || {};
  if (!env.VITE_PEER_HOST) return {};
  return {
    host: env.VITE_PEER_HOST,
    port: Number(env.VITE_PEER_PORT) || 443,
    path: env.VITE_PEER_PATH || '/',
    secure: String(env.VITE_PEER_SECURE ?? 'true') !== 'false',
  };
}
