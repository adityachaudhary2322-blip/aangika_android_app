/**
 * ISL Connect — meeting content script.
 *
 * Injects a floating HUD into Google Meet / Zoom Web / WhatsApp Web, finds the
 * user's own self-view <video>, and can drop a translated line straight into
 * the meeting chat.
 *
 * THREE DESIGN DECISIONS WORTH THE WORDS:
 *
 * 1. SHADOW DOM, CLOSED-ISH. The HUD lives in a shadow root attached to a host
 *    element. Meet and WhatsApp ship aggressive global CSS and their own
 *    MutationObservers; without shadow isolation their styles bleed into the
 *    HUD and, worse, our styles can break their layout. Nothing here touches
 *    the page's own stylesheet.
 *
 * 2. SELF-VIEW IS FOUND BY MIRRORING, NOT BY SELECTOR. Every one of these apps
 *    obfuscates class names and changes them without notice, so a CSS selector
 *    is guaranteed to rot. But all three mirror the local preview and only the
 *    local preview -- it is the one <video> with a negative horizontal scale in
 *    its computed transform. That property is behavioural, not cosmetic, so it
 *    survives redesigns.
 *
 * 3. CHAT INSERTION IS BEST-EFFORT AND SAYS SO. Typing into someone else's
 *    React-controlled input means dispatching synthetic events and hoping their
 *    handler believes them. It works today on Meet; it is the first thing that
 *    will break when Meet ships a redesign. The HUD reports failure rather than
 *    appearing to succeed, and always leaves the text on the clipboard as a
 *    fallback.
 */

(() => {
  'use strict';

  const HOST_ID = 'isl-connect-hud-host';
  if (document.getElementById(HOST_ID)) return;   // already injected

  const SITE = (() => {
    const h = location.hostname;
    if (h.includes('meet.google.com')) return 'meet';
    if (h.includes('zoom.us')) return 'zoom';
    if (h.includes('web.whatsapp.com')) return 'whatsapp';
    return 'unknown';
  })();

  // ── Self-view detection ────────────────────────────────────────────────────

  /**
   * Find the local preview: the one <video> the page mirrors.
   *
   * Falls back to the smallest visible video, which is what a self-view
   * thumbnail almost always is, when nothing is explicitly mirrored (Zoom does
   * not always mirror).
   */
  function findSelfView() {
    const videos = [...document.querySelectorAll('video')].filter((v) => {
      const r = v.getBoundingClientRect();
      return r.width > 40 && r.height > 40 && v.readyState >= 2;
    });
    if (videos.length === 0) return null;

    const mirrored = videos.filter((v) => {
      const t = getComputedStyle(v).transform;
      if (!t || t === 'none') return false;
      // matrix(a, b, c, d, e, f) -- a < 0 is a horizontal flip.
      const m = t.match(/matrix\(([-\d.]+)/);
      return m ? parseFloat(m[1]) < 0 : false;
    });
    if (mirrored.length) return mirrored[0];

    return videos.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    })[0];
  }

  // ── Chat insertion ─────────────────────────────────────────────────────────

  /** Per-site chat input locators, most specific first. */
  const CHAT_SELECTORS = {
    meet: [
      'textarea[aria-label*="Send a message" i]',
      'textarea[placeholder*="Send a message" i]',
      'div[contenteditable="true"][aria-label*="message" i]',
      'textarea[jsname]',
    ],
    zoom: [
      'div[contenteditable="true"][aria-label*="chat" i]',
      'textarea[aria-label*="chat" i]',
      '#wc-chat-input',
    ],
    whatsapp: [
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
  };

  function findChatInput() {
    for (const sel of CHAT_SELECTORS[SITE] || []) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  /**
   * Put `text` into the chat box and submit.
   *
   * React tracks input values on the DOM node itself, so assigning `.value`
   * directly is invisible to it -- the native setter has to be called through
   * the prototype descriptor before the synthetic 'input' event will be
   * believed. This is the fragile part.
   */
  function insertIntoChat(text) {
    const input = findChatInput();
    if (!input) return { ok: false, reason: 'Chat box not found — open the chat panel first.' };

    try {
      input.focus();

      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;
        setter?.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // contenteditable: execCommand is deprecated but is still the only
        // thing WhatsApp's editor reliably accepts.
        document.execCommand('insertText', false, text);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      }

      // Enter to send.
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
        }));
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'fixed', right: '18px', bottom: '96px', zIndex: '2147483647',
    width: '260px',
  });
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      /* Everything is scoped to this shadow root; the page cannot reach in
         and we cannot leak out. */
      :host, * { box-sizing: border-box; }
      .card {
        background: rgba(23, 31, 51, 0.94);
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 16px;
        color: #DAE2FD;
        font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0,0,0,0.45);
        backdrop-filter: blur(10px);
        overflow: hidden;
      }
      .bar {
        display: flex; align-items: center; gap: 6px;
        padding: 8px 10px; cursor: grab;
        background: rgba(34, 42, 61, 0.9);
      }
      .bar:active { cursor: grabbing; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #4EDEA3; }
      .dot.off { background: #F59E0B; }
      .title { font-weight: 600; font-size: 11px; letter-spacing: .3px; }
      .x { margin-left: auto; cursor: pointer; opacity: .6; padding: 0 2px; }
      .x:hover { opacity: 1; }
      .body { padding: 10px; }
      .cap {
        min-height: 40px; border-radius: 10px; padding: 8px;
        background: rgba(11,19,38,.8); font-size: 14px; font-weight: 600;
      }
      .muted { color: #BBCAAF; font-weight: 400; font-size: 11px; }
      .row { display: flex; gap: 6px; margin-top: 8px; }
      button {
        flex: 1; border: 0; border-radius: 9px; padding: 7px 8px;
        font: 600 11px system-ui, sans-serif; cursor: pointer;
        background: #2D3449; color: #DAE2FD;
      }
      button.primary { background: #4EDEA3; color: #0B1326; }
      button:disabled { opacity: .45; cursor: not-allowed; }
      .note { margin-top: 6px; font-size: 10px; color: #BBCAAF; }
      .note.err { color: #F43F5E; }
    </style>

    <div class="card">
      <div class="bar" id="bar">
        <span class="dot" id="dot"></span>
        <span class="title">ISL CONNECT</span>
        <span class="x" id="close">✕</span>
      </div>
      <div class="body">
        <div class="cap" id="cap"><span class="muted">Waiting for a caption…</span></div>
        <div class="row">
          <button id="send" class="primary" disabled>Send to chat</button>
          <button id="copy" disabled>Copy</button>
        </div>
        <div class="note" id="note"></div>
      </div>
    </div>
  `;

  const $ = (id) => root.getElementById(id);
  const capEl = $('cap');
  const noteEl = $('note');
  const dotEl = $('dot');
  const sendBtn = $('send');
  const copyBtn = $('copy');

  let caption = '';

  function setNote(text, isError = false) {
    noteEl.textContent = text || '';
    noteEl.className = 'note' + (isError ? ' err' : '');
  }

  function setCaption(text) {
    caption = text || '';
    capEl.textContent = caption || '';
    if (!caption) {
      capEl.innerHTML = '<span class="muted">Waiting for a caption…</span>';
    }
    sendBtn.disabled = !caption;
    copyBtn.disabled = !caption;
  }

  $('close').addEventListener('click', () => host.remove());

  sendBtn.addEventListener('click', () => {
    const result = insertIntoChat(caption);
    if (result.ok) {
      setNote('Sent to chat.');
    } else {
      // Always leave the text somewhere the user can get at it.
      navigator.clipboard?.writeText(caption).catch(() => {});
      setNote(`${result.reason} Copied to the clipboard instead.`, true);
    }
    setTimeout(() => setNote(''), 4000);
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setNote('Copied.');
    } catch {
      setNote('Clipboard blocked by the page.', true);
    }
    setTimeout(() => setNote(''), 2500);
  });

  // Drag by the title bar. Pointer events cover mouse and touch in one path.
  (() => {
    const bar = $('bar');
    let dragging = false;
    let offX = 0;
    let offY = 0;

    bar.addEventListener('pointerdown', (e) => {
      dragging = true;
      const r = host.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      host.style.left = `${e.clientX - offX}px`;
      host.style.top = `${e.clientY - offY}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    });
    bar.addEventListener('pointerup', () => { dragging = false; });
  })();

  // ── Self-view watch ────────────────────────────────────────────────────────

  let selfView = null;

  function refreshSelfView() {
    const found = findSelfView();
    if (found !== selfView) {
      selfView = found;
      dotEl.className = 'dot' + (selfView ? '' : ' off');
      setNote(selfView ? '' : 'Self-view not found yet — turn your camera on.');
    }
  }

  refreshSelfView();
  const observer = new MutationObserver(refreshSelfView);
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(refreshSelfView, 3000);   // Meet swaps video nodes silently

  // ── External API ───────────────────────────────────────────────────────────

  /**
   * The PWA (or a future offscreen recogniser) pushes captions in via
   * postMessage. The extension does NOT run the ONNX model itself: the 21 MB
   * graph plus MediaPipe inside a content script would fight the meeting app
   * for the same GPU and CPU, and Meet is already the heaviest thing on the
   * page. Recognition stays in the PWA; this HUD displays and forwards.
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'isl-connect') return;
    if (data.type === 'caption') setCaption(String(data.text || ''));
    if (data.type === 'send' && data.text) {
      setCaption(String(data.text));
      sendBtn.click();
    }
  });

  // Expose the self-view element for a future in-page recogniser.
  Object.defineProperty(window, '__islConnect', {
    value: {
      site: SITE,
      getSelfView: () => selfView,
      setCaption,
      insertIntoChat,
    },
    configurable: true,
  });

  setNote(`Ready on ${SITE}.`);
  setTimeout(() => setNote(''), 2500);
})();
