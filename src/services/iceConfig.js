/**
 * ICE configuration for the P2P call.
 *
 * WHY TURN IS NOT OPTIONAL HERE. STUN only tells a peer its own public
 * address. That is enough behind a cone NAT, but Indian mobile carriers
 * (Jio and Airtel especially) put subscribers behind carrier-grade NAT that is
 * usually *symmetric*: the public port changes per destination, so the address
 * STUN reports is useless to anyone else. Two symmetric-NAT peers can never
 * reach each other directly, however long ICE runs. A TURN server fixes it by
 * relaying the media, at the cost of bandwidth.
 *
 * CREDENTIALS ARE REQUIRED. A TURN URL with no username/credential is not a
 * half-working TURN server -- the allocate request is rejected with 401 and the
 * browser silently discards the candidate. There is no console error and the
 * call simply never connects, which looks exactly like the bug this file exists
 * to fix. The defaults below are Metered's published open credentials; put your
 * own account's key in Settings for anything you actually depend on.
 */

const STORAGE_KEY = 'isl.turnCredentials';

/** Metered's published open-relay credentials. */
export const DEFAULT_TURN = {
  username: 'openrelayproject',
  credential: 'openrelayproject',
};

export function getTurnCredentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TURN, source: 'default' };
    const parsed = JSON.parse(raw);
    if (parsed?.username && parsed?.credential) {
      return { ...parsed, source: 'custom' };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { ...DEFAULT_TURN, source: 'default' };
}

export function setTurnCredentials(username, credential) {
  try {
    if (!username || !credential) {
      localStorage.removeItem(STORAGE_KEY);
      return { ...DEFAULT_TURN, source: 'default' };
    }
    const value = { username: username.trim(), credential: credential.trim() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return { ...value, source: 'custom' };
  } catch {
    return getTurnCredentials();
  }
}

/**
 * Build the iceServers list.
 *
 * Both a UDP and a TCP TURN entry are listed, plus TLS on 443. Restrictive
 * mobile and corporate networks frequently block UDP outright, and 443/TLS is
 * the entry most likely to survive a hostile network because it is
 * indistinguishable from ordinary HTTPS.
 */
export function buildIceServers() {
  const { username, credential } = getTurnCredentials();
  return [
    // STUN first: when the NAT allows a direct path, take it -- a relayed call
    // costs the TURN server bandwidth and adds a hop of latency.
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:standard.relay.metered.ca:80' },

    // TURN, in increasing order of "gets through a hostile network".
    { urls: 'turn:standard.relay.metered.ca:80', username, credential },
    { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username, credential },
    { urls: 'turn:standard.relay.metered.ca:443', username, credential },
    { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username, credential },
  ];
}

/**
 * Ask the browser to gather ICE candidates and report what it actually got.
 *
 * This is the only honest way to answer "will this connect on mobile data".
 * A `relay` candidate means TURN authenticated and allocated successfully; its
 * absence means TURN is not working, whatever the config says, and a
 * symmetric-NAT call will fail.
 *
 * @returns {Promise<{host:number, srflx:number, relay:number, ok:boolean, error:string|null}>}
 */
export function testIceServers(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const counts = { host: 0, srflx: 0, relay: 0, ok: false, error: null };
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: buildIceServers() });
    } catch (err) {
      resolve({ ...counts, error: err?.message || String(err) });
      return;
    }

    const finish = () => {
      clearTimeout(timer);
      try { pc.close(); } catch { /* already closed */ }
      counts.ok = counts.relay > 0;
      resolve(counts);
    };

    const timer = setTimeout(finish, timeoutMs);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return finish();          // gathering complete
      const type = event.candidate.type;              // host | srflx | relay
      if (type && counts[type] !== undefined) counts[type] += 1;
      // A relay candidate is the answer; no need to wait for the rest.
      if (type === 'relay') finish();
      return undefined;
    };

    pc.onicecandidateerror = (event) => {
      // 401/403 here is the signature of bad or missing TURN credentials.
      if (event?.errorCode >= 400 && !counts.error) {
        counts.error = `TURN rejected the credentials (${event.errorCode} ` +
          `${event.errorText || ''}). Check the TURN username and key.`;
      }
    };

    try {
      pc.createDataChannel('probe');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((err) => {
          counts.error = err?.message || String(err);
          finish();
        });
    } catch (err) {
      counts.error = err?.message || String(err);
      finish();
    }
  });
}

export default { buildIceServers, testIceServers, getTurnCredentials, setTurnCredentials };
