# Aangika vs. similar products

A feature-level comparison with the apps people reach for today, and what was
changed in Aangika as a result. Competitor notes are from their public product
descriptions, not from testing, so treat them as a summary, not a benchmark.

## Who else is in this space

| Product | What it does | Where it is strong |
|---|---|---|
| **Google Live Transcribe** | Real-time speech-to-text on Android | Running conversation log, type-back, large text, saved transcripts, works everywhere |
| **Ava** | Captions for group conversations | Speaker labels, transcript history, polished app UI |
| **Hand Talk** | Text/voice → sign via a 3-D avatar (ASL, Libras) | Dictionary of signs, learning mode, friendly onboarding |
| **SignAll / Signapse** | Camera sign recognition, sign avatars for businesses | Recognition quality, enterprise deployment |
| **Microsoft Translator / Google Translate** | Speech and text translation | Conversation mode, phrasebook, share/export |
| **WhatsApp / Meet video calls** | General video calling | No sign support, but the calling UX users expect |

## Where Aangika already stands out

- **Indian Sign Language, both directions**: few products cover ISL at all.
- **11 Indian languages** for spoken output.
- **Signed video calls with live captions**, peer-to-peer and without accounts.
- **On-device recognition** (ONNX + MediaPipe), plus an offline grammar path.
- **Teach your own signs**: custom handshapes for names and phrases.

## Gaps found, and what was done

| Gap (vs. competitors) | Before | Change |
|---|---|---|
| Opening straight into a sign-up form | The app started on the profile/handle form | Opens on Home. The profile is only asked for in the Messages tab, the one place that needs it |
| Navigation | Tools hidden behind a settings icon in Messages | Bottom tab bar (Home, Translate, Messages, Settings) with an unread badge |
| Look and feel | Utility grid of tiles | New palette, typography, hero actions and consistent cards in light and dark |
| Conversation log (Live Transcribe, Ava) | Each recording replaced the previous transcript | Running log of both sides, kept on the device across reloads |
| Type-back (Live Transcribe) | "Type Reply" button did nothing | Type a reply and it is read aloud, shown full screen and added to the log |
| Save or share transcripts | "Save Notes" did nothing | Copy all, or save as a `.txt` file |
| Honest status | Hard-coded "Dr. Sharma", "99.2% clarity", "14 ms latency", fake dB meter | Removed. Shows the real time the last transcription took |
| Dictionary (Hand Talk) | No way to see what the camera understands | **Word list**: all recognisable words, searchable, tap to hear, with your own signs |
| Installable app | No web manifest or icons | Manifest, icons and home-screen shortcuts (Sign, Speech, Messages) |

## Still open (not done in this change)

- **Sign videos or an avatar in the Word list.** Competitors show how to sign
  each word. That needs licensed clips or an avatar pipeline.
- **Offline caching (service worker).** Needs care with the 21 MB model and
  the ONNX wasm files so updates do not serve stale weights.
- **Speaker labels in group conversations** (Ava). Transcription is one voice
  at a time today.
- **Group room.** Still marked "Soon" on Home.
- **Streaming speech-to-text.** Transcription runs after you stop recording.
  Live Transcribe streams word by word.
- **Recognition accuracy.** The model is at 0.44 precision / 0.22 recall on
  live windows (see `docs/RESULTS_v2.md`). That is the biggest gap to
  SignAll-class products, and retraining is the project's current goal.
