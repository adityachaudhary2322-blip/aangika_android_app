# Aangika: 3-minute demo script and checklist

The demo uses only paths that are **measured to work** (see docs/RESULTS_ASL.md
and docs/RESULTS_v2.md) or that are **your own taught signs**, which are
matched against your own recordings and are the most reliable path for you.
Nothing is scripted or faked: every word on screen comes from recognition.

## Before the judges arrive: checklist

**Night before**
- [ ] **Glove:** battery charged; glove flashed (docs/GLOVE.md); Settings → Glove → Calibrate open, then fist.
- [ ] **Glove signs taught** (Settings → Glove → Teach, 3 takes each): **DOCTOR, HELP, NEED**, plus the letters of your name (**A, D, I, T, Y**; a repeated letter needs only one sign) and **NAME**.
- [ ] **Camera signs taught** (My signs): one **sentence** sign, e.g. "Please speak slowly", with Hindi filled in (it is filled automatically when you save it online). One **name** sign for yourself.
- [ ] **Demo mode rehearsal** (Settings → Demo): practise each sign you plan to show at least 3 times. Only show signs marked **reliable** (≥ 2 of 3).
- [ ] If the ASL model is approved and deployed: rehearse the ASL signs in Demo mode too. Show only the reliable ones.

**One hour before**
- [ ] **Keys:** Settings → API keys: **Sarvam** key saved. Grammar engine: **Sarvam**. Output language: **Hindi**. Do not rely on Gemini's free tier: it returned "high demand" (503) on 2026-09-29.
- [ ] **Offline ready:** Settings → **Prepare for offline** (or open Sign to speech once online). Every model card shows "ready on this device".
- [ ] **Devices:** phone Bluetooth on, glove connected (bars move), volume up, phone charged, brightness up.
- [ ] **Lighting:** light in front of you, not behind; plain background; your shoulders in the frame.
- [ ] **Backup:** a screen recording of one full run, in case the venue's network or lighting fails.

## The script (3 minutes)

| Time | You do | What the judges see and hear |
|---|---|---|
| 0:00-0:15 | One line: "Deaf signers in India have no everyday interpreter. Aangika reads signs on a phone, offline, and speaks them in 11 Indian languages." | Home screen |
| 0:15-0:40 | **Sign to speech** → Start. Sign **HELLO** (open palm, raised) with the SignBridge engine. | Chip **HELLO**, spoken **"नमस्ते"**. Say: "built-in handshape, on the phone, no network needed." |
| 0:40-1:05 | Sign your taught **sentence sign**. | "Please speak slowly", spoken in Hindi from the translation stored when you taught it. Say: "anyone can teach the app their own signs in 3 takes, no retraining." |
| 1:05-1:45 | Glove on. Sign **DOCTOR**, **HELP**, **NEED**, then relax the hand. | Chips doctor · help · need. After the pause the sentence **"I need a doctor's help."** appears and is spoken in Hindi by Sarvam. Say: "ISL word order is rearranged into a proper sentence." |
| 1:45-2:15 | **Spell on.** Fingerspell your name with the glove letters, then sign **NAME**. | The letters join into one word ("Aditya", marked *spelled*), then "Hello, my name is Aditya." / "नमस्ते, मेरा नाम आदित्य है।" (the wording can vary slightly with Sarvam) |
| 2:15-2:40 | **Settings → Demo**: show the "Measured on you" table and one live confidence view. | Real per-sign success rates. Say: "we only claim what we measure; our ISL research model scores 0.44 precision on unseen clips, and this is how we find the signs that work." |
| 2:40-3:00 | **Airplane mode on.** Sign HELLO again. | It still works offline. Close: "open models, on-device, measured honestly." |

## If something goes wrong

| Problem | Do this |
|---|---|
| Glove will not connect | Settings → Glove → Disconnect, flex hard to wake it, connect again. Otherwise skip to the camera signs. |
| Sarvam slow or failing | Tap the **Offline** badge: the local rules still build the sentence (English, plus the Hindi templates). |
| A sign is not recognised | Hold it still for a second; keep your shoulders in view. Then move on: do not retry more than twice on stage. |
| Camera black | Back → Sign to speech again; check the browser's camera permission. |
