# Sarvam proxy: Sarvam for every user, without them adding a key

The app sends Sarvam requests (sentences, translation, voice, speech-to-text)
to this small Cloudflare Worker. The Worker adds **your** Sarvam key, which is
stored as a Cloudflare secret, and forwards the request to `api.sarvam.ai`.
The key is never in the website bundle or the APK.

Why Cloudflare Workers: free (100,000 requests a day), and it never sleeps, so
the first request of a demo is not slow.

## Deploy (PowerShell, about 5 minutes)

```powershell
cd C:\dev\aangika\proxy\sarvam
npx wrangler login                        # opens the browser; free Cloudflare account
npx wrangler secret put SARVAM_API_KEY    # paste your Sarvam key when asked (not echoed)
npx wrangler deploy                       # prints https://aangika-sarvam.<you>.workers.dev
```

1. Edit `wrangler.toml` first: set `ALLOWED_ORIGINS` to your real site address
   (e.g. `https://aangika.onrender.com`), then deploy (or redeploy).
2. Check it: open `https://aangika-sarvam.<you>.workers.dev/health` - it says `ok`.

## Point the app at it

The address is built into the app at build time (it is not a secret):

- **Render:** Dashboard → the static site → Environment → add
  `VITE_SARVAM_PROXY_URL` = `https://aangika-sarvam.<you>.workers.dev` → redeploy.
- **Local / Android build:** add the same line to `C:\dev\aangika\.env.local`
  and `C:\dev\aangika-android\.env.local`, then rebuild the APK.

With it set, new users start on the Sarvam engine automatically, and Settings
shows "Sarvam is included". A user can still enter their own key; it then
goes direct to Sarvam instead.

## What protects your key and credit

- Only the four endpoints the app uses, POST only; chat limited to the app's
  models and 800 reply tokens.
- Only requests from your site and the Android app (`https://localhost`) are
  accepted. A script can fake that header, so this stops casual reuse only;
- a per-IP limit (30 requests/minute, `RATE_PER_MIN`) and request size caps.
- **Set a spend limit / alerts in the Sarvam dashboard too.** That is the real
  ceiling if someone abuses the proxy.
- Nothing is logged or stored by the Worker.

Rotate the key any time with `npx wrangler secret put SARVAM_API_KEY`; the app
needs no change.
