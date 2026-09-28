# Phase 1 audit: retraining the Aangika word tagger

Status: **partial.**

- **Complete:** §4, and the vocab-only half of §3.
- **Done for the supplied notebook:** §1. It turned out *not* to be the tagger's
  training notebook (§1.0).
- **Partial:** §2, from the notebook log and the file size. The read-only
  inspection script has not run yet.

Nothing here changes code. Every claim cites a file, cell or line, or is marked
*inferred* / *unverified*.

---

## 1. How the current tagger was trained

### 1.0 Headline: the supplied notebook did NOT train the word tagger

The notebook supplied is `Downloads\notebookc8c9fa762a.ipynb` (Kaggle
`kartikmerothiya/notebookc8c9fa762a`, run 2026-09-06). It is not in the repo yet;
copy it to `reference/old_notebook.ipynb`. It has 4 cells: markdown 0 and code
1-3. Refs below are `Cell <index>` plus `L<n>`, a line number in a plain-text dump
of all cells in order (source followed by outputs). A function name is given
wherever one exists, so each ref can be found without the dump.

- **Cell 2** builds `isign_ctc_dataset.h5`, the file now in `Downloads`.
- **Cell 3** trains `SignSentenceTranslator`, a **character-level CTC** model: 43
  classes, `TIME_UPSAMPLE=2`, outputs `logits` (Cell 3, `ITOS` / `export_vocab`).
  The shipped tagger instead has output `frame_logits` with 1500 word classes,
  sigmoid/MIL decoding, `val_mAP` and an operating curve. **None of that appears in
  this notebook.** There is no BCE loss, no word vocabulary, no mAP and no threshold
  sweep.
- The CTC run **failed**. Validation character error rate (CER) plateaued at
  **0.84** and loss at 2.90. By epoch 30 the output for "in his letter he said" is
  `'e  e   .'`, meaning it collapsed to frequent characters. It produced
  `checkpoint_sentence_model.pth` and `isign_sentence_translator.onnx`, and neither
  is used by the app.
- The validation set also differs: 6,156 clips here vs. **5,854** in
  `vocab.json:1708`. So the tagger ran with a different split or a filtered subset,
  in a notebook we do not have.

**Conclusion:** we now know the tagger's *data* (this `.h5`) and *backbone* (the
same Conv1d → 3×BiLSTM as Cell 3, with a 1500-way per-frame head instead of 86).
We do not know its loss, pooling, split, augmentation or how mAP was computed.
**The word-tagger notebook is still needed.** The checkpoint's `config` key may
answer part of this (see §5).

### 1.1 What this notebook establishes (it applies to the tagger's data)

| Topic | Finding | Ref |
|---|---|---|
| Data source | **iSign v1.1** (HF `Exploration-Lab/iSign`). Uses its *precomputed* `.pose` files (`iSign-poses_v1.1_part_aa..ad`, 158.5 GiB), streamed straight from the zip with no local extraction. The iSign videos are not used. | Cell 2 CONFIG L72; output L1284-1300 |
| Labels | `iSign_v1.1.csv`, `uid` → `text` (an English sentence per clip). 126,846 pairs; 126,846 of 127,237 `.pose` files matched. `word-presence` / `word-description` CSVs contributed 0 pairs. | Cell 2 `discover_labels`; L1285-1288 |
| Word labels from sentences | **Not in this notebook.** The tagger must have derived the bag of words from the `text` column elsewhere. The stems in vocab.json (§3c) show a crude suffix stripper. | — |
| Landmark extraction | Done by the **iSign authors** with MediaPipe **Holistic**. The Holistic settings (`model_complexity`, smoothing, `static_image_mode`) are *not recorded* anywhere we have. The notebook maps components by name (`pose`, `left`, `right`), with a fallback to file order (L654-686). | Cell 2 `component_slices` |
| Coordinates | pose-format stores pixel coordinates. They are divided by `(w, h, w)` to recover MediaPipe-normalised values (L713-722), and **z is divided by width**. Low-confidence points (`conf == 0`) are set to exactly 0 (L567, L634). | Cell 2 `features_from_pose` |
| Trimming | Leading and trailing frames with **no pose** are dropped before resampling (`TRIM_EMPTY`, L727-731). Frames without hands are kept. | Cell 2 |
| 192 resample | `SV_NUM_FRAMES=192` overrides the default of 120 (Cell 1 L37). Uniform nearest index `floor(linspace(0, n-1, 192) + 0.5)` (L742-743) over the whole trimmed clip. Short clips get duplicated frames and long clips get dropped frames. | Cell 1, Cell 2 |
| Storage | `features (N, 192, 225)` **float16**, gzip-4, 1 clip per chunk; `text`, `name`, `n_frames_raw` (L921-936). The data is **not body-normalised**; normalisation must happen in the training loader. | Cell 2 `_open_h5` |
| Handedness / mirroring | Nothing mirrors or flips. Left/right come from the Holistic component names, i.e. MediaPipe's own assignment on the unmirrored source video. **No flip augmentation.** | Cell 2 |
| Split (CTC run) | Random **clip-level** shuffle, 5% val, seed 1337 (Cell 3 `load_index`, L1696-1701). **No grouping by source video, signer or sentence.** | Cell 3 |
| Loss / pooling / aug (CTC run) | `nn.CTCLoss(blank=0, zero_infinity=True)`, AdamW 3e-4, cosine schedule, AMP, 30 epochs. **No augmentation and no body normalisation.** | Cell 3 `train` |

### 1.2 Concrete flaws, with cell references

1. **N1: leakage risk in the split** (Cell 3 L1696-1701). iSign clips are
   consecutive segments of the same news videos, with one signer per video. A random
   clip split puts the same signer, lighting and background, and often
   near-duplicate sentences, in both train and val. If the tagger's 5,854-clip val
   set was made the same way, **`val_mAP` 0.233 is optimistic**. Needs checking once
   the tagger notebook or `.h5` names are available (§2).
2. **N2: 3,727 clips (2.9%) silently dropped** (output L1307-1308): 3,697
   `RuntimeError`s and 30 `ValueError`s. `_decode_one` swallows the reasons, and
   the counts suggest network/range failures during the 2.5 h stream (short reads)
   rather than bad data. The dropped set is not recorded, so it may be biased
   (e.g. whole zip regions).
3. **N3: stale metadata.** The `.h5` attr says `"resample": "uniform_nearest_to_120"`
   (Cell 2 L942), but the data is 192 frames (output L1311). Cell 3's `export_vocab`
   likewise documents `round(linspace…)` while the code uses `floor(x + 0.5)`.
4. **N4: float16 storage** (Cell 2 L87). Fine for zeros, since 0 stays exactly 0.
   But landmarks lose about 3 significant digits *before* `bodyNormalise`, while the
   app normalises float32. The parity test must feed identical float16-rounded
   inputs to both sides, or it will fail for reasons unrelated to the logic.
5. **N5: value range [-0.009, 2.166]** in sample 0 (output L1310). x or y above 1
   means points off-frame or an aspect/scale mismatch in the pixel → normalised
   conversion. Needs a histogram check (§2).
6. **N6: z scaling assumption.** z is divided by frame width (L720). That matches
   the JS Holistic convention, but the app uses **Tasks**, whose pose z scale
   differs (see §4b). Unverified.
7. **N7: CTC design was never going to work here.** ISL-to-English is not
   monotonic, targets average 59.8 characters (L2073), and there is no language
   model. The run confirms it (CER 0.84). The word-bag tagger was the right pivot;
   don't revisit CTC.
8. **N8: `.pose` confidence thresholding is binary** (`conf > 0`). Low-confidence
   but non-zero hand detections are kept as real landmarks, whereas MediaPipe Tasks
   in the app drops hands below 0.5 presence. There is a train/serve difference in
   *when a hand is zero*.

### 1.3 Earlier inferences from vocab.json (still unconfirmed for the tagger)

**What the shipped metadata tells us** (`public/models/vocab.json`):

| Question | Evidence in vocab.json | Status |
|---|---|---|
| Frame count | `"num_frames": 192` (L1520) | stated |
| Resampling | `"resample": "uniform: idx = floor(linspace(0, n-1, num_frames) + 0.5)"` (L1529). This is nearest-frame index selection, so it duplicates frames on short clips and drops frames on long ones. | stated |
| Normalisation | `body_normalise_spec` (L1531-1539) matches `signRecognizer.js:148-168` | stated, matches |
| Output semantics | "ordered list of content words, NOT a sentence" (L4); decode = sigmoid, max over time, threshold, top-k, sort by peak (L1584-1591) | stated |
| Labels from sentences | The vocab is frequency-ordered news vocabulary (see §3) with stopwords removed and a crude suffix stripper applied. *Inferred:* labels are the bag of stemmed content words of each clip's English sentence, with no temporal alignment. That makes this weak (MIL) supervision. | inferred |
| Data source | The vocabulary is Indian news (modi, covid, bjp, lockdown, sushant, rhea, ncb…). *Inferred:* sentence-level ISL news video, most likely ISH News as packaged in iSign. | inferred |
| Val set | `"val_clips": 5854` (L1708), `val_mAP` 0.233 (L1511) | stated; split method unknown |
| Threshold choice | 0.15, chosen for about 2 words/clip at 49% precision (L1508, L1593) | stated |

**Flaws visible without the notebook:**

- **F1. `measured` contradicts the shipped threshold.** `measured` (L1704-1709)
  reports P=0.6231, R=0.1656, 1.12 words/clip. Those numbers are exactly the
  **0.30** row of `operating_curve` (L1626-1630), but the app runs at **0.15**
  (L1508). At 0.15 the real figures are P=0.488, R=0.233 (L1608-1612).
- **F2. Low recall.** At the shipped threshold recall is 0.23, so 3 of every 4
  content words are missed even in-distribution (L1610).
- **F3. Val numbers are clip-level and offline.** They measure whole 192-frame
  resampled clips. They say nothing about the app's 40-frame live window (§4a).

Once the notebook is readable, §1 still needs: the exact Holistic settings
(`model_complexity`, `refine_face_landmarks`, `static_image_mode`, confidences),
whether any mirroring or flip augmentation was applied, how train/val was split (by
clip, sentence or signer; whether duplicate sentences leak), loss (BCE? pos_weight?
focal?), pooling used during training (max vs. LSE vs. attention), augmentation, and
how mAP and the operating curve were computed (per-class macro? which clips?).

## 2.0 Raw dataset: `G:\My Drive\isl_dataset` (verified 2026-09-28, read-only)

This is the full iSign v1.1 pose release, i.e. the source the `.h5` was built from.
It holds **no videos**.

| Item | Finding |
|---|---|
| Files | `iSign-poses_v1.1_part_aa..ad`: a byte-split zip, 3 × 48,318,382,080 B + 25,275,140,832 B = 158.5 GiB, matching the HF sizes exactly. Also `iSign_v1.1.csv` (uid,text), `word-presence-dataset_v1.1.csv` (word_id, word, sentence_id, sentence), `word-description-dataset_v1.1.csv`, and `iSign-poses_v1.1_combined.tar.gz` (**0 bytes**: an abandoned concat, ignore it). |
| Completeness | The zip central directory reads cleanly: **127,237 `.pose` members** (230.1 GiB uncompressed), 1:1 with the CSV (0 missing either way). 100 sampled members were read with a CRC check: 0 failures. Conclusion: **the upload is complete.** |
| Content | 124,585 sentence clips (`<video>-<n>`, from **3,726 source videos**, median 24 clips/video, max 492); **586 isolated word signs** (`<id>_w`); 1,492 example-sentence clips (`_e<n>`); 574 definition clips (`_d`). The `.h5` build matched only `iSign_v1.1.csv`, so the word clips' labels were never used. |
| Labels | Sentence text per uid. For the isolated signs, the word itself (word CSVs). Word vocabulary: rare/formal English (abandon, abash, abnegation…), **not** conversational. |
| Signer ids | None. The source video (`uid` minus `-<n>`) is the only grouping key. `data.GROUP_RE` must also strip `_w/_e<n>/_d` for word clips. |
| Components | Holistic `POSE_LANDMARKS` 33, `FACE_LANDMARKS` 468, `LEFT_HAND_LANDMARKS` 21, `RIGHT_HAND_LANDMARKS` 21, `POSE_WORLD_LANDMARKS` 33 |
| Format | pose-format **v0.1**, body header `<HHH` (fps as an integer, frames, people) |
| fps (50 sampled) | sentences: 25 (15/40) or 29 (25/40, i.e. 29.97 truncated); isolated: 29 (9/10), 25 (1/10) |
| Duration | sentences: 1.0 / **6.2** / 44.5 s (min/median/max), 29-1,291 frames; isolated: 4.6 / 6.3 / 9.6 s |
| Resolution | **300×300** in 46/50 sampled, the rest ~630×715. The `.h5` divides x by w and y by h. If 300×300 is a *placeholder* rather than the real frame size, x/y are distorted for those clips. This must be checked before trusting normalised coordinates (see N5). |

**Implications:**
- **Canonical fps: 25.** It is native for many clips, close to 29.97 for the rest, and near typical webcam detection rates.
- **Full frame rate is recoverable.** The raw archive keeps every frame, so the live regime (BASELINE cell B) can be reconstructed exactly from the `.pose` files instead of from the 192-resampled `.h5`.
- **Still no videos.** Tasks extraction (cells C and D) needs the iSign video archive (53.9 GiB on HF), which is not in this folder.

## 2. Dataset: `Downloads\isign_ctc_dataset.h5` (partly verified)

The user supplied `C:\Users\ADITYA CHAUDHARY\Downloads\isign_ctc_dataset.h5`. It is
**one HDF5 file, not a folder of videos**, and it is the Cell 2 output described in
§1.1. CLAUDE.md still names `.../aangika_signbridge` as the dataset and should be
updated.

**Known from the file size and the notebook log:**

| Item | Value | Source |
|---|---|---|
| Size on disk | 5,611,462,399 bytes = 5,351.5 MiB | `ls` |
| Expected size | "file size: 5351.5 MiB" | nb output L1309 |
| Samples | 123,119 clips (126,846 matched, 3,727 skipped) | nb output L1307 |
| Schema | `features (N,192,225) float16`, `text (N,) utf-8`, `name (N,) utf-8`, `n_frames_raw (N,) int32` | Cell 2 `_open_h5` |
| Attrs | `complete=True`, `n_samples=123119`, `num_frames=192`, `feature_dim=225` | nb output L1311 |
| Content | **Sentence-level** continuous ISL news clips (iSign). **No isolated word signs.** | §1.1 |
| Labels | One English sentence per clip in `text`. **No word labels, glosses or timestamps.** | Cell 2 |
| Signer ids | **Not stored.** Only `name` (the iSign `uid`, e.g. `<video>-<n>`), so the source video is the only grouping proxy. | Cell 2 |
| fps / duration | **Not stored.** Only `n_frames_raw` (frame count after trimming). iSign videos are about 25-30 fps, so duration ≈ `n_frames_raw` / fps. Unverified. | Cell 2 |
| Videos | None. The 53.9 GiB iSign video archive was never downloaded. | nb output L1290 |

**Upload completeness:** the size matches the notebook's reported output to 0.1 MiB,
so the download is **very likely complete**. HDF5 is not a zip, and truncation
would show up as an unreadable tail chunk. That is still to be proven by reading the
last row (script below).

**Not yet run** (blocked by the tool errors). `scratchpad/inspect_h5.py` is written
and read-only, and should take a few minutes. It reports:

- keys, attrs, and the first and last rows (truncation check)
- 50 random rows: finite values, value range, per-frame hand/pose presence
- percentiles of `n_frames_raw`
- distinct `uid` prefixes, i.e. videos, as the signer proxy
- duplicate-sentence counts
- vocab.json overlap: which of the 1,500 words appear in `text`, and frequent
  dataset words that are missing
- counts for hello / you / my / what / not / name / aditya

The output will be added here as §2.1.

## 3. Vocabulary (`public/models/vocab.json`)

Dataset-overlap numbers are **blocked** by §2. From the vocab alone:

**3a. It is a news vocabulary, not a conversational one.** Many high-rank slots go
to news-only terms: `government` (L14), `police` (L16), `minister` (L42),
`court` (L75), `modi` (L84), `covid` (L61), `crore` (L111), `lakh` (L141), `bjp`
(L215), `lockdown` (L225).

**3b. Core conversational signs are absent.** None of these exist as vocab
entries: `hello`, `hi`, `namaste`, `you`, `my`, `me`, `we`, `he`, `she`,
`what`, `where`, `how`, `why`, `when`, `who`, `no`, `not`, `sorry`, `bye`,
`toilet`, `sick`. `morning` only exists as the stem `morn` (L667). This matters more
than the junk entries: ISL depends on WH-question and negation signs, and the app
cannot emit them at all.

Present and useful: `i` (L8), `deaf` (L25), `help` (L26), `want` (L24), `water`
(L43), `home` (L55), `name` (L65), `mother` (L164), `good` (L179), `father` (L242),
`eat` (L341), `thank` (L480), `please` (L535), `yes` (L687).

**3c. Junk entries.** Each one wastes an output channel, and the stem variants also
split training signal.

- Ordinal/abbreviation fragments: `th` (L15), `rs` (L37), `st` (L254), `nd` (L548),
  `rd` (L400), `ed` (L1328), `00` (L924), `000` (L81), `com` (L800), `mr` (L422),
  `dr` (L758), `ish` (L426), `cal` (L79), `min` (L1317), `sri` (L854), `lok`
  (L1327), `non` (L1079), `anti` (L1432).
- Filler/interjections and non-lexical items: `etc` (L29), `uh` (L977), `oh`
  (L1120), `wow` (L982), `blank` (L166), `dash` (L167).
- Numbers and years: about 45 entries, e.g. `10`, `19`, `20`, `2019`-`2024`, `500`.
  They are only useful if the dataset signs digits in a consistent way.
- Broken possessives from tokenising on `'s`: `india'` (L353), `let'` (L296),
  `that'` (L603), `government'` (L1010), `world'` (L1099), `there'` (L1336),
  `women'` (L1385), `pakistan'` (L1431).
- Contractions kept as single tokens: `don't` (L212), `can't` (L607), `isn't`,
  `wasn't`, `didn't`, `doesn't`, `won't`, `couldn't`, `i'm`.
- Over-stemmed or mangled forms (a naive `-ing`/`-ed`/`-es`/`-ies` stripper):
  `announc`, `decid`, `alway`, `someth`, `anyth`, `noth`, `everyth`, `morn`,
  `kil`, `mak`, `tak`, `plac`, `clos`, `forc`, `fil`, `mis`, `pas`, `sel`, `ris`,
  `rais`, `scor`, `stres`, `mov`, `fac`, `goe`, `eate`, `treate`, `movy`
  (movies), `sery` (series), `discuse`, `wed`.
- Stem + full-form duplicates (same concept, two channels): `announc`/
  `announcement`, `decid`/`decide`, `increas`/`increase`, `continu`/`continue`,
  `chang`/`change`, `complet`/`complete`, `provid`/`provide`, `issu`/`issue`,
  `reduc`/`reduce`, `encourag`/`encourage`, `prepar`/`prepare`, `carri`/`carry`,
  `distanc`/`distance`, `charg`/`charge`, `believ`/`believe`, `experienc`/
  `experience`, `remov`/`remove`, `purchas`/`purchase`, `stres`/`stress`,
  `mov`/`move`/`moved`, `kil`/`kill`, `worri`/`worry`, `injur`/`injury`,
  `infect`/`infection`.
- Inflection duplicates (ISL signs the lemma once; tense is separate):
  `said`/`say`, `went`/`go`/`gone`/`going`, `took`/`take`/`taken`/`tak`,
  `told`/`tell`, `came`/`come`, `gave`/`give`/`given`, `saw`/`see`/`seen`/`seeing`,
  `got`/`get`, `made`/`make`/`mak`, `knew`/`know`/`known`, `died`/`die`/`dead`,
  `spoke`/`speak`, `heard`/`hear`, `thought`/`think`, `felt`/`feel`,
  `bought`/`buy`, `brought`/`bring`, `wrote`/`write`/`written`, `sold`/`sell`,
  `met`/`meet`, `lost`/`lose`, `kept`/`keep`, `began`/`begin`, `sent`/`send`,
  `paid`/`pay`, `taught`/`teach`, `understood`/`understand`, `fell`/`fall`,
  `won`/`win`, `ran`/`run`, `broke`/`broken`/`break`, `learnt`/`learn`,
  `caught`/`catch`, `built`/`build`, `led`/`lead`, `used`/`use`/`using`,
  `lived`/`live`, `loved`/`love`, `named`/`name`, `added`/`add`,
  `children`/`child`, `men`/`man`, `women`/`woman`, `raped`/`rape`.
- Spelling variants: `colour`/`color`, `centre`/`center`, `cloth`/`clothe`.
- Personal names (about 35): `modi`, `singh`, `khan`, `kumar`, `shah`, `trump`,
  `kohli`, `dhoni`, `sushant`, `rhea`, `virat`, `rahul`, `amit`, `kejriwal`,
  `thackeray`, `uddhav`, `ambani`, `musk`, `biden`, `salman`, `kapoor`,
  `priyanka`, `yadav`, `aryan`, `vijay`, `jain`, `raj`, `ram`, `narendra`,
  `gandhi`, `sharma`…. In ISL these are usually fingerspelled or name-signs
  specific to one signer, so they are unlikely to generalise.

Rough estimate: **250-350 of the 1500 channels** are junk, stem duplicates or
inflection duplicates. A proper lemmatiser (spaCy/WordNet) plus a stoplist would
merge them into far fewer, cleaner classes.

**3d. custom_signs** (L1710-1739). NAMASTE, HELLO, MY and ADITYA are
`in_model: false`, and NAME maps to index 59. The comment at L1711 says `words`
"must never grow", but that is only a constraint of the current ONNX graph. Options:

1. **Re-map junk slots (keeps V = 1500).** Reassign indices currently held by junk
   (`th`, `rs`, `etc`…) to NAMASTE/HELLO/MY/YOU/WHAT/… and retrain the head, or the
   whole model, with the new labels. The app contract and `NUM_WORDS` stay
   unchanged. This needs labelled clips for each new word.
2. **Change V (clean vocab).** Retrain with a lemmatised vocab of a different
   size. This needs the §4c fix (read V from vocab.json) and a vocab.json schema
   bump.
3. **ADITYA** is a proper name. It should be fingerspelled or a personal name sign
   recorded by the user, and it needs custom recordings whichever option is chosen.
   MY / HELLO / NAMASTE likely exist in isolated-sign datasets (INCLUDE,
   ISL-CSLTR); needs checking against §2.

## 4. Known mismatches: confirmed

**4a. 192 resampled frames in training vs. a raw 40-frame window in the app. CONFIRMED.**
- `vocab.json:1520` `"num_frames": 192`; `vocab.json:1529` uniform resample of the
  **whole clip** to 192.
- `useSignPipeline.js:10-11`: `/** ... The model was trained at 192 ... */ const WINDOW = 40;`
- `useSignPipeline.js:13` `STRIDE = 20`; `:263-273` pushes every detected frame
  (camera fps, typically 15-30 and variable) and runs inference on the raw last 40
  with no resampling.
- Consequences:
  - Temporal scale differs. A 5 s training sentence at 25 fps (125 frames) was
    *stretched* to 192. Live, 40 frames covers about 1.3-2.7 s of real time. The
    BiLSTM and the convolutions see motion at a different speed than in training.
  - The bidirectional LSTM was trained with full-sentence context and now sees
    fragments.
  - MIL labels covered the whole sentence; a 40-frame window almost never
    corresponds to one training example.

**4b. Holistic in training vs. Tasks with "latest" model URLs in the app. CONFIRMED.**
- `landmarker.js:8-12` itself says the model was trained on Holistic and that
  accuracy under Tasks "has never been measured".
- `landmarker.js:15` uses `HandLandmarker` + `PoseLandmarker` (Tasks).
- `landmarker.js:18` pins WASM to `@0.10.14`, but `:20` and `:22` load
  `.../float16/latest/hand_landmarker.task` and
  `.../pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`. Model weights
  can change under a pinned runtime without any deploy.
- `landmarker.js:22` uses **pose_landmarker_lite**. Holistic's default is pose
  complexity 1 (full), so pose coordinates, especially z, will differ.
- Hands differ too. Holistic crops hands from pose-predicted ROIs and assigns
  left/right from pose. Tasks runs an independent palm detector and assigns
  handedness from a classifier (`landmarker.js:121-126`) that assumes a mirrored
  (selfie) image.
- **Handedness is unverified.** `packFrame` swaps labels when `mirrored`
  (`signRecognizer.js:117-122`), and `useSignPipeline.js:40` defaults
  `mirrored = true`. The raw `<video>` frames given to MediaPipe are *not*
  flipped (CSS mirroring affects display only), and Tasks labels assume a flipped
  image, so the swap may be correct for the wrong stated reason. Whether it matches
  Holistic's subject-perspective left/right in the training data **must be
  verified with a real clip in the parity phase**. Nobody has checked it.

**4c. NUM_WORDS hardcoded to 1500. CONFIRMED.**
- `signRecognizer.js:22` `export const NUM_WORDS = 1500;`
- `:52-56` throws if `vocab.words.length !== NUM_WORDS`.
- `:201-215` size the pooling arrays and index logits with `NUM_WORDS` rather than
  `vocab.words.length` or the output tensor's dims.
- Also hardcoded in `vocab.json:1507`, `:1580`, and the header comment
  `signRecognizer.js:7`. Any V ≠ 1500 needs all of these changed together.
- `signRecognizer.js:4` cites `ISL-FINAL/models/production/MODEL_CARD.md`, which is
  not in this repo.

**4d. RecordedVideoTranslator only uses SignBridge. CONFIRMED.**
- `RecordedVideoTranslator.jsx:8` imports only `classifySignBridgeFrame`.
- `:22-25` doc comment states it runs the static SignBridge classifier one frame at
  a time.
- `:110` is the only classifier call.
- `signRecognizer` is never imported, so uploaded videos never reach the tagger.
  This is the easiest place to use the tagger at its trained 192-frame setting:
  a whole recorded clip resampled to 192.

**4e. API keys are read from localStorage and sent from the browser. CONFIRMED.**
- Read: `translator.js:34-44` (`isl.geminiKey`, `isl.sarvamKey`), `ttsService.js:163`.
- Written: `translator.js:46-53`.
- Sent directly from the client:
  - Gemini: `translator.js:103-110` (`x-goog-api-key`)
  - Sarvam TTS: `translator.js:160-164`, `ttsService.js:173-177`
    (`api-subscription-key`)
  - Sarvam STT: `translator.js:226-228`
- `Settings.jsx:153` tells users this.
- Any XSS or malicious extension can read the keys, and they appear in devtools
  network logs. Moving them behind a server proxy (e.g. the `render.yaml` service)
  is separate from the model work but worth tracking.

**4f. Other findings:**
- `.gitignore` has no entries for `training/data`, `training/runs`, `*.pt`,
  `*.pth`, `*.onnx` outside `public/models`, `*.mp4`/`*.mov`/`*.webm`, or `*.zip`.
  This is required by the CLAUDE.md rules and must be added before any training
  files exist in the tree.
- `training/`, `reference/signcam/` and `reference/old_notebook.ipynb`, all named in
  CLAUDE.md, do not exist in this checkout.
- The repo is on `main`; `feature/tagger-v2` does not exist yet.

## 5. Recommended plan and changes to later phases

**Unblock first (user action):**
1. **Find the word-tagger notebook.** The supplied notebook trains CTC, not the
   tagger (§1.0). If it can't be found, the checkpoint's `config` / `words` /
   `threshold` keys are the fallback record.
2. Run `python <scratchpad>/inspect_h5.py` and paste the output, or let the tools
   run it. That finishes §2 and the dataset-overlap half of §3.
3. Unzip `Downloads\checkpoint_word_tagger.zip` to
   `training/checkpoints/checkpoint_word_tagger` (gitignored), or confirm its
   location.
4. Update CLAUDE.md so the dataset is the read-only `Downloads\isign_ctc_dataset.h5`
   rather than `aangika_signbridge`, or say whether a separate `aangika_signbridge`
   upload also exists.
5. Provide `reference/signcam/` if it is meant to be borrowed from.

**Changes from the notebook findings:**
- **The dataset can't cover custom signs.** iSign is sentence-level news with no
  isolated signs and no `hello` / `namaste` channel in the current vocab.
  NAMASTE, HELLO, MY and YOU need an isolated-sign source (e.g. INCLUDE /
  ISL-CSLTR) or **self-recorded clips**. ADITYA always needs self-recorded clips.
  P4 must include a data-collection step.
- **P3 re-extraction with Tasks is harder.** The `.h5` holds only Holistic
  landmarks, and the videos were never downloaded (53.9 GiB). Options: (a)
  download a subset of iSign videos and extract them with Tasks in Python, or (b)
  train on Holistic features with augmentation that imitates Tasks (landmark
  jitter, hand dropout at the Tasks presence threshold, z rescale). Measure the gap
  with (a) on a few hundred clips before choosing.
- **The split must group by source video** (the `uid` prefix). Otherwise
  retrained metrics can't be compared honestly with the old 0.233, which may itself
  be inflated (N1).
- **The parity test must use float16-rounded inputs** (N4).
- **Live windows are feasible.** Because the `.h5` stores already-resampled
  192-frame clips, not raw frames, P5 can only simulate the live 40-frame window
  by re-resampling. `n_frames_raw` gives each clip's original length, so a
  40-frame live window at about 25-30 fps can be approximated by taking
  `40 × 192 / n_frames_raw` consecutive stored frames and resampling them to 40.

**Proposed phases** (each commits on `feature/tagger-v2` and stops for review):

- **P2: Hygiene and parity harness.**
  - Add `.gitignore` rules.
  - Write a Python `pack_frame`/`body_normalise` and a node test running the real
    `signRecognizer.js` functions on shared fixtures; assert bit-for-bit float32
    equality.
  - Add a *handedness* fixture from a real non-mirrored clip, checked against
    Holistic's output.
  - Load the checkpoint in PyTorch and export it to ONNX. Verify the result matches
    `sanketvani_word_tagger.onnx` logits, which proves the architecture in
    CLAUDE.md is correct.
- **P3: Baseline under app conditions.**
  - Re-extract a val subset with **Tasks** (the same models the app uses, pinned
    versions rather than `latest`).
  - Evaluate the existing model at 192-resampled and at a live-style 40-frame
    window.
  - This measures the §4a/4b gap before spending anything on training.
- **P4: Vocab v2.**
  - Lemmatise, drop junk, merge duplicates, add conversational and custom signs
    backed by data.
  - Decide between keeping V=1500 via re-mapping (option 1) and variable V
    (option 2). Variable V needs the §4c code change.
- **P5: Retrain from the existing checkpoint.**
  - Tasks-extracted features, signer- and sentence-disjoint split.
  - Training on random crops at the app's window length and frame rate, so train
    and serve match.
  - Handedness and flip handled deliberately.
  - Asks before any job longer than 10 minutes.
- **P6: App integration (small).**
  - Pin landmarker model URLs.
  - Read V from vocab.json.
  - Optionally resample recorded videos to the trained length and use the tagger in
    RecordedVideoTranslator.
  - Model files are released to `public/models` only on approval.

**What this audit changes:** (a) the 40-vs-192 mismatch means P5 should train on
the serving window rather than change the app back to 192. (b) Evaluating in P3
before training is essential, because the current offline mAP says nothing about
live accuracy. (c) Vocab cleanup is a first-class phase, since roughly 20% of
output channels are wasted and core conversational words are missing.

## Blockers encountered during this audit

- Every attempt at a shell (Bash/PowerShell), web fetch or Drive-connector call
  failed with "auto mode classifier gave no verdict". That is a transient
  tool-side error, not a refusal.
- Because of it, the checkpoint zip was not opened, `inspect_h5.py` was not run,
  and `git` could not run: no branch was created and nothing was committed.
- The notebook was read from the local `.ipynb` the user supplied.
