# ISL Connect — meeting extension (scaffold)

Overlays a caption HUD on Google Meet, Zoom Web and WhatsApp Web, and can drop a
translated line into the meeting chat.

## Load it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `extension/` folder
3. Open a call on a supported site; the HUD appears bottom-right and can be dragged

## Status: scaffold, not finished

**This has not been loaded in a browser.** It is written against the MV3 spec and
each site's current DOM, but nothing here has been observed running in a real
meeting. Expect to iterate on the chat selectors.

What works by design:
- MV3 manifest scoped to the three hosts
- Shadow-DOM HUD, isolated from the page's CSS in both directions
- Self-view detection by *mirroring* rather than by class name

What is genuinely fragile:
- **Chat insertion.** Typing into another app's React-controlled input means
  dispatching synthetic events through the native value setter and hoping the
  handler believes them. It will break when Meet redesigns. The HUD reports
  failure and falls back to the clipboard rather than silently doing nothing.
- **No custom icons.** The manifest deliberately declares none, because Chrome
  refuses to load an extension whose manifest points at an icon file that is not
  there. Chrome supplies a default. Add real PNGs and an `icons` block together.

## What it deliberately does not do

Run the recogniser. The 21 MB ONNX graph plus MediaPipe inside a content script
would compete with the meeting app for the same GPU and CPU, and Meet is already
the heaviest thing on the page. Recognition stays in the PWA, which pushes
captions in:

```js
window.postMessage({ source: 'isl-connect', type: 'caption', text: 'I need water.' }, '*');
window.postMessage({ source: 'isl-connect', type: 'send',    text: 'I need water.' }, '*');
```

`window.__islConnect` exposes `getSelfView()`, `setCaption()` and
`insertIntoChat()` for a future in-page recogniser.
