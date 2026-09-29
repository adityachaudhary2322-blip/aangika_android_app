# Aangika API (Cloudflare Worker)

One small server for everything that must not live inside the app:

1. **Sarvam proxy.** Every user gets Sarvam (sentences, translation, voice,
   speech-to-text) without entering a key. Your Sarvam key is a Cloudflare
   secret, never in the website bundle or the APK.
2. **Community sign dictionary.** Developers publish signs they taught (My
   signs → For developers → developer code); every copy of the app and
   website downloads them. The developer code is a Cloudflare secret, checked
   here, so it cannot be read out of the app.

Why Cloudflare Workers: free (100,000 requests a day, KV storage included)
and it never sleeps, so the first request of a demo is not slow.

## Deploy (PowerShell, about 10 minutes)

```powershell
cd C:\dev\aangika\server
npx wrangler login                          # opens the browser; free Cloudflare account
npx wrangler kv namespace create DICT       # prints an id: paste it into wrangler.toml
npx wrangler secret put SARVAM_API_KEY      # paste your Sarvam key (not echoed)
npx wrangler secret put DEV_CODE            # type the developer code (not echoed)
npx wrangler deploy                         # prints https://aangika-api.<you>.workers.dev
```

Before deploying, edit `wrangler.toml`:
- `ALLOWED_ORIGINS`: your real site address (e.g. `https://aangika.onrender.com`);
- the `DICT` id from the `kv namespace create` step.

Check it: `https://aangika-api.<you>.workers.dev/health` says `ok`.

## Point the app at it

Built in at build time (the address is not a secret):

- **Render:** Environment → `VITE_API_URL` = `https://aangika-api.<you>.workers.dev` → redeploy.
- **Android:** the same line in `C:\dev\aangika-android\.env.local`, then rebuild the APK.

Then Settings says "Sarvam is included", new users start on Sarvam, and My
signs / Word list show the community dictionary with an **Update** button.
(`VITE_SARVAM_PROXY_URL`, the earlier name, still works.)

## Publishing signs (developers)

My signs → **For developers** → enter the developer code → tick the signs →
**Publish to everyone**. Every device picks them up on its next update: when
the app starts or comes back online, every 15 minutes while open, or when
someone taps **Update**. Remove a shared sign there with **Remove for everyone**.

Rules the server applies: only trained signs (with samples), valid names,
at most 150 signs / 12 MB in total, one sign per name (a user's own sign with
the same name wins on their device).

## What protects your key, your code and your credit

- Sarvam: only the four endpoints the app uses, POST only, chat limited to the
  app's models and 800 reply tokens, request size caps, 30 requests/minute per
  IP (`RATE_PER_MIN`). **Also set a spend limit in the Sarvam dashboard**: an
  Origin header can be faked by a script, so that is the real ceiling.
- Developer code: compared in constant time; 5 wrong codes per IP per 15
  minutes, and publishing locks for the hour after 30 wrong codes from anyone.
  A 6-digit code is still short: a longer code (letters and digits) makes
  guessing hopeless. Change it any time with `npx wrangler secret put DEV_CODE`.
- Only requests from your site and the Android app are accepted.
- Nothing is logged; the dictionary holds only what developers publish.

## Run it locally

```powershell
$env:DEV_CODE = 'any-local-code'; node scripts/dev-api.mjs     # http://localhost:8787
```
Same code, in-memory storage. The browser tests use it:
`npx playwright test -c playwright.api.config.js`.
