# Aangika for Android

This repository is the website (`upstream`) plus a thin Capacitor shell.
**Almost all code is shared**: the only Android-specific files are:
- `capacitor.config.json`
- `src/native/` (native Bluetooth for the glove, the back button, the splash screen)
- `android/` (the generated Android Studio project)
- this document

## What the app bundles (works offline from first launch)

| Inside the APK | Size |
|---|---|
| ISL tagger v2 (`public/models/sanketvani_word_tagger_v2.onnx`) + vocab | 20.4 MB |
| onnxruntime-web wasm | 27.8 MB |
| MediaPipe Tasks wasm (from `@mediapipe/tasks-vision` 1.0.1) | 33.8 MB |
| MediaPipe hand, pose-lite and face `.task` models (pinned `float16/1`) | 16.6 MB |

- **Not bundled yet:** the ASL isolated-sign model. It awaits approval in the website repo; once approved, `git merge upstream/main` brings it in and the next build bundles it.
- **Downloads later from Settings:** other models, as they are added.

## Build a debug APK (PowerShell)

Prerequisites:
- **JDK 21**: Capacitor 7 requires it. JDK 17 fails with "invalid source release: 21", and Android Studio's bundled JDK 25 is too new for Gradle 8.11. A portable Temurin 21 is unpacked at `C:\dev\jdk21` on this PC; elsewhere, install Temurin 21.
- the **Android SDK** (`%LOCALAPPDATA%\Android\Sdk`, installed with Android Studio).

```powershell
cd C:\dev\aangika-android
$env:JAVA_HOME = 'C:\dev\jdk21'           # JDK 21, only for this window
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

npm ci
node scripts/fetch-offline-assets.mjs     # MediaPipe wasm + .task files into public/mediapipe
npm run build                             # web app -> dist/
npx cap sync android                      # copy dist/ into the Android project
cd android
.\gradlew.bat assembleDebug               # -> app\build\outputs\apk\debug\app-debug.apk
```

## Install on your phone over USB (adb)

1. **Phone:** Settings → About phone → tap **Build number** 7 times, then Settings → Developer options → **USB debugging** on.
2. Connect the cable, and accept the "Allow USB debugging?" prompt on the phone.
3. Install:
   ```powershell
   $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
   & $adb devices                                   # your phone should be listed as "device"
   & $adb install -r C:\dev\aangika-android\android\app\build\outputs\apk\debug\app-debug.apk
   & $adb logcat -s Capacitor:* chromium:*          # live logs while you test
   ```
- **Without adb:** copy `app-debug.apk` to the phone, open it, and allow "Install unknown apps" for your file manager.

## Test checklist on the phone

| Check | How |
|---|---|
| ISL recognition in **airplane mode** | Airplane mode on → open app → Sign to speech → Start. It must load with no network. |
| ASL recognition in airplane mode | After the ASL model is approved and bundled: Settings → Recognition → American (ASL). |
| Glove over Bluetooth | Glove on → Settings → Glove → Connect over Bluetooth → allow "Nearby devices". |
| Fingerspelling → sentence | Teach letters (My signs or glove) → Spell on → spell a name → pause → sentence spoken. |
| Meet | Two phones → Meet → same room code → captions. |
| Speech to text (online) | Speech to text screen → speak → words appear (needs network + Sarvam key). |
| Back button | From any screen goes back to Home; from Home it closes the app. |

## Release signing (one time)

```powershell
cd C:\dev\aangika-android\android
keytool -genkeypair -v -keystore aangika-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias aangika
```

Create `android\keystore.properties`. It is git-ignored: **never commit it or the .jks file**.
```
storeFile=aangika-release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=aangika
keyPassword=YOUR_KEY_PASSWORD
```

Then load it from `app/build.gradle` (`signingConfigs { release { … } }`, reading `keystore.properties`) and build:
```powershell
.\gradlew.bat assembleRelease     # signed APK for sideloading
.\gradlew.bat bundleRelease       # .aab for the Play Store
```
**Back up the keystore and its passwords.** If you lose them, you can never update the app on the Play Store.

## Play Store

1. **Account:** create a Google Play Console developer account. There is a **one-time registration fee (US$25)** and identity verification.
2. **App:** create the app, then upload the `.aab` from `bundleRelease` to an internal-testing track first.
3. **Forms:**
   - **Data safety:** camera and microphone are processed on the device; speech and translation text is sent to Sarvam / Gemini when online; no video is stored.
   - **Content rating** questionnaire.
   - **Target audience.**
4. **Contacts:** if friend discovery (Phase 6) is enabled, add the **prominent disclosure** before asking for the contacts permission, and declare it.
5. **Rollout:** internal → closed → production.

## Keeping up with the website

Fixes are made in the website repository and merged here:
```powershell
cd C:\dev\aangika-android
git fetch upstream
git merge upstream/main
npm ci; node scripts/fetch-offline-assets.mjs; npm run build; npx cap sync android
```

To publish this repo, create an empty GitHub repository (e.g. `aangika-android`), then:
```powershell
git remote add origin https://github.com/<you>/aangika-android.git
git push -u origin main
```

## Not done yet (depends on later phases)

- **Native Google sign-in** and **read-only contacts** for friend discovery: these need the Supabase project (Phase 6).
- **Testing on a real phone over adb:** needs your phone connected.
