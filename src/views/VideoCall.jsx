import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic, MicOff, SwitchCamera, Captions, PhoneOff, Hand, Ear, Volume2, VolumeX,
  Repeat, Loader2,
} from 'lucide-react';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import EngineToggle from '../components/EngineToggle.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import useIslSigns from '../hooks/useIslSigns.js';
import useIslSentence from '../hooks/useIslSentence.js';
import cameraManager from '../services/cameraManager.js';
import { translate } from '../services/translationService.js';
import { speak, stop as stopSpeaking } from '../services/ttsService.js';
import { isSupported as sttSupported, createRecognizer } from '../services/sttService.js';
import { durationString } from '../lib/utils.js';
import { useCall } from '../context/CallContext.jsx';
import {
  ROLE_SIGNER, ROLE_SPEAKER, setProfileRole, getContact,
} from '../services/chatStorage.js';

/**
 * The full-screen in-call surface.
 *
 * This used to own the Peer, the lobby and the room-code exchange. It owns none
 * of them now: CallContext holds the registration for the life of the tab, and
 * this component mounts only once a call is actually up. What is left is
 * everything that is genuinely ABOUT being in a call — the assistive relay, the
 * captions, the PiP and the dock.
 *
 * THE RELAY, unchanged. A call is only assistive if the two ends do DIFFERENT
 * things, and neither end can know which without being told. Roles are
 * exchanged over the DataChannel on connect ('role-sync', in CallContext);
 * every pipeline and every pixel below is derived from the PAIR, not from one
 * side's own choice:
 *
 *   signer  + speaker -> classify landmarks here, send text; they hear it spoken
 *   speaker + signer  -> run STT here, send text; speak their sign captions
 *   signer  + signer  -> no pipelines at all, full-resolution video, no clutter
 *   speaker + speaker -> an ordinary video call
 *
 * WHICH SIGNS. The signer picks the recogniser: the app's models (a caption
 * that grows sign by sign) or ISL Studio, the team's own dictionary (continuous
 * signing; the FULL STOP sign sends the finished sentence to be spoken).
 */
const SOURCE_KEY = 'aangika-call-sign-source';
const readSource = () => { try { return localStorage.getItem(SOURCE_KEY) === 'studio' ? 'studio' : 'models'; } catch { return 'models'; } };
export default function VideoCall({
  language, setLanguage, mode, visionEngine, chooseVision,
}) {
  const {
    call, myRole, peerRole, remoteStream, connectionState, diagnostic,
    setDiagnostic, remoteLine, linkReady, endCall, sendCaption,
    muted, toggleMute,
  } = useCall();

  const [captions, setCaptions] = useState(true);
  const [voiceOut, setVoiceOut] = useState(true);     // speak incoming signs
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());
  const [swapped, setSwapped] = useState(false);      // PiP holds the remote feed
  const [seconds, setSeconds] = useState(0);
  const [signerLine, setSignerLine] = useState('');
  const [mySpeech, setMySpeech] = useState('');       // live STT hypothesis
  const [sttState, setSttState] = useState('idle');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const spokenRef = useRef('');       // last sentence handed to TTS, for dedupe
  const sentLineRef = useRef('');     // last sign caption put on the wire

  const contact = getContact(call.handle);
  const them = contact?.name || call.handle || 'them';
  const live = call.status === 'live';

  // ── What this PAIR of roles means ─────────────────────────────────────────
  //
  // Until 'role-sync' lands, fall back to the role recorded against the contact
  // and then to "complementary". That is the overwhelmingly common case, and
  // assuming it gets captions flowing from the first frame instead of after a
  // signalling round trip; the moment the real role arrives this derivation
  // corrects itself and the UI follows.
  const relay = useMemo(() => {
    const theirs = peerRole
      || contact?.role
      || (myRole === ROLE_SIGNER ? ROLE_SPEAKER : ROLE_SIGNER);
    if (myRole === ROLE_SIGNER) {
      return theirs === ROLE_SIGNER ? 'sign-to-sign' : 'sign-to-speech';
    }
    return theirs === ROLE_SIGNER ? 'speech-to-sign' : 'voice';
  }, [myRole, peerRole, contact?.role]);

  /** Classify landmarks only when a hearing peer is waiting for the text. */
  const signingActive = live && relay === 'sign-to-speech';
  /** Run the microphone recogniser only when a signer is waiting for the text. */
  const listeningActive = live && relay === 'speech-to-sign';
  /** Two signers: the video IS the language, so nothing may cover it. */
  const cleanVideo = relay === 'sign-to-sign';

  const [source, setSourceState] = useState(readSource);
  const setSource = (v) => { setSourceState(v); try { localStorage.setItem(SOURCE_KEY, v); } catch { /* not remembered */ } };
  const { signs: islSigns } = useIslSigns();
  const studioReady = islSigns.some((x) => x.type === 'full-stop');

  const { words, stats, frameRef } = useSignPipeline({
    enabled: signingActive && source === 'models',
    mirrored,
    visionEngine,
    language,
    mode,
    // Deliberately NOT auto-speaking here: the other party already hears the
    // synthesised voice over the call, so speaking locally would echo back.
    autoSpeak: false,
  });

  // Mirroring follows the camera manager, never a local toggle.
  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  // Anything this surface started must stop when it unmounts, whichever way the
  // call ended. CallContext owns the peer and the streams; the voice is ours.
  useEffect(() => () => stopSpeaking(), []);

  // ── Remote stream -> <video> ──────────────────────────────────────────────

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el || !remoteStream) return;
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream;
    el.playsInline = true;
    // Autoplay policy: unmuted playback can be refused. Retry muted rather than
    // leaving a frozen black rectangle, and say why it is silent.
    el.play().catch(() => {
      el.muted = true;
      el.play()
        .then(() => setDiagnostic({
          tone: 'warn',
          message: 'Audio muted by the browser — tap the screen to enable it.',
        }))
        .catch(() => {});
    });
  }, [remoteStream, setDiagnostic]);

  // ── Local preview ─────────────────────────────────────────────────────────

  /**
   * Bind the local <video> straight to the shared camera stream.
   *
   * A second <video> on the SAME MediaStream costs nothing and does not
   * re-acquire the camera, so the single-getUserMedia design still holds.
   * `muted` is mandatory: an unmuted local preview feeds audio back AND has its
   * autoplay refused outright by mobile browsers.
   */
  const attachLocalPreview = useCallback(() => {
    const el = localVideoRef.current;
    const stream = cameraManager.getStream();
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.muted = true;
    el.play().catch(() => {});
  }, []);

  useEffect(() => {
    attachLocalPreview();
    // Re-bind periodically: flipping the camera swaps the underlying stream.
    const id = setInterval(attachLocalPreview, 1000);
    return () => clearInterval(id);
  }, [attachLocalPreview]);

  // ── ISL Studio signs -> sentence at FULL STOP -> wire ─────────────────────

  const studio = useIslSentence({
    signs: islSigns,
    active: signingActive && source === 'studio',
    language,
    mode,
    onSentence: (r) => {
      const text = r.translated || r.english;
      if (!text) return;
      setSignerLine(text);
      sentLineRef.current = text;
      sendCaption('sign', text);
    },
  });
  const studioPartial = source === 'studio' && studio.sentence.length
    ? `${studio.sentence.map((x) => x.word).join(' ')} …`
    : '';

  // ── Signs -> text -> wire ─────────────────────────────────────────────────

  useEffect(() => {
    if (!signingActive || source !== 'models' || words.length === 0) return undefined;
    let cancelled = false;
    translate(words.map((w) => w.word), language, { mode }).then((r) => {
      if (cancelled) return;
      const text = r.translated || r.english;
      if (!text) return;
      setSignerLine(text);
      // Only put a CHANGED sentence on the wire. The classifier re-emits the
      // same tokens for as long as a sign is held, and re-sending would make
      // the speaker's phone read the same sentence aloud over and over.
      if (text !== sentLineRef.current) {
        sentLineRef.current = text;
        sendCaption('sign', text);
      }
    });
    return () => { cancelled = true; };
  }, [words, signingActive, source, language, mode, sendCaption]);

  // ── Microphone -> text -> wire (speaker side) ─────────────────────────────

  useEffect(() => {
    if (!listeningActive) return undefined;

    if (!sttSupported()) {
      setSttState('unsupported');
      setDiagnostic({
        tone: 'warn',
        message:
          'This browser has no live speech recognition, so the signer cannot '
          + 'see your words. Chrome or Safari can.',
      });
      return undefined;
    }

    const recognizer = createRecognizer({
      lang: language,
      onPartial: setMySpeech,
      onFinal: (text) => {
        setMySpeech(text);
        sendCaption('speech', text);
      },
      onState: setSttState,
      onError: (message) => setDiagnostic({ tone: 'warn', message }),
    });
    recognizer.start();

    return () => {
      recognizer.stop();
      setMySpeech('');
    };
  }, [listeningActive, language, sendCaption, setDiagnostic]);

  // ── Incoming sign captions -> voice (speaker side) ────────────────────────

  useEffect(() => {
    if (!live || myRole !== ROLE_SPEAKER || !voiceOut) return;
    if (remoteLine?.kind !== 'sign') return;
    // The far end only sends a sentence when it changes, but a reconnect or a
    // re-render must not make the phone say it twice.
    if (remoteLine.text === spokenRef.current) return;
    spokenRef.current = remoteLine.text;
    speak(remoteLine.text, language);
  }, [remoteLine, live, myRole, voiceOut, language]);

  // ── Capture profile follows the relay ─────────────────────────────────────

  useEffect(() => {
    if (!live) return;
    // Between two signers no detector runs, so the pixels the downscale was
    // protecting are free again -- and those are exactly the pixels that carry
    // handshape and finger position.
    cameraManager.setQuality(cleanVideo ? 'high' : 'standard');
  }, [live, cleanVideo]);

  // ── Controls ──────────────────────────────────────────────────────────────

  function toggleVoiceOut() {
    // Stop mid-sentence rather than letting the current utterance finish: the
    // reason to hit this button is usually that it is saying the wrong thing.
    if (voiceOut) stopSpeaking();
    setVoiceOut((v) => !v);
  }

  function flipRole() {
    setProfileRole(myRole === ROLE_SIGNER ? ROLE_SPEAKER : ROLE_SIGNER);
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  // One main box and one PiP box, exchanged by tapping the small one. The two
  // <video> elements keep their position in the tree and swap only className,
  // so neither is ever unmounted and no MediaStream has to be re-bound -- which
  // would black the feed out for a frame on every tap.
  const MAIN_BOX = 'absolute inset-0 z-0 h-full w-full bg-black';
  const PIP_BOX =
    'absolute right-3 top-16 z-30 h-44 w-32 cursor-pointer overflow-hidden '
    + 'rounded-2xl border border-white/25 bg-surface-low shadow-2xl active:scale-95';

  const swap = () => setSwapped((v) => !v);
  const incomingSpeech = remoteLine?.kind === 'speech' ? remoteLine.text : '';
  const incomingSign = remoteLine?.kind === 'sign' ? remoteLine.text : '';

  return (
    <div className="fixed inset-0 z-50 h-full w-full overflow-hidden bg-black">
      {/* Their feed */}
      <div
        className={swapped ? PIP_BOX : MAIN_BOX}
        onClick={swapped ? swap : undefined}
        role={swapped ? 'button' : undefined}
        aria-label={swapped ? 'Show their video full screen' : undefined}
      >
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
        {swapped && (
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white">
            THEM
          </span>
        )}
      </div>

      {/* Your feed. The front camera is mirrored so a raised right hand appears
          on the right, the way it does in a mirror; the back camera already
          shows the world the right way round and must NOT be flipped. */}
      <div
        className={swapped ? MAIN_BOX : PIP_BOX}
        onClick={swapped ? undefined : swap}
        role={swapped ? undefined : 'button'}
        aria-label={swapped ? undefined : 'Show your video full screen'}
      >
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={'h-full w-full object-cover ' + (mirrored ? 'scale-x-[-1]' : '')}
        />
        {signingActive && <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />}
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white">
          {signingActive ? `${stats.fps} fps` : 'YOU'}
        </span>
      </div>

      {/* Pre-connect gate. The two waits are NOT the same thing and must not
          look the same: during 'preparing' the far end has not been contacted
          at all, so saying "waiting for them to pick up" would be a lie. */}
      {!live && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/70 px-8 text-center">
          <Loader2 size={30} className="animate-spin text-primary" />
          {call.status === 'preparing' ? (
            <>
              <p className="text-lg font-semibold text-white">Starting camera…</p>
              <p className="text-xs text-white/60">
                Allow camera and microphone access to call {them}.
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-white">Calling {them}…</p>
              <p className="text-xs text-white/60">Waiting for them to pick up.</p>
            </>
          )}
        </div>
      )}

      {/* Top scrim */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 scrim-top p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="pill chrome-plate font-mono text-ink">
            {durationString(seconds)}
          </span>
          <span className="pill chrome-plate max-w-[9rem] truncate text-ink">
            {them}
          </span>
          <span
            className={
              'pill chrome-plate '
              + (connectionState === 'connected' || connectionState === 'completed'
                ? 'text-primary'
                : connectionState === 'failed' ? 'text-rose' : 'text-ink-dim')
            }
          >
            {connectionState || 'connecting'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {signingActive && (
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                aria-label="Which signs to recognise"
                className="pill chrome-plate text-[11px]"
              >
                <option value="models">Signs: app models</option>
                <option value="studio" disabled={!islSigns.length}>Signs: ISL Studio{islSigns.length ? '' : ' (no signs)'}</option>
              </select>
            )}
            {signingActive && source === 'models' && (
              <EngineToggle value={visionEngine} onChange={chooseVision} compact />
            )}
            {!cleanVideo && (
              <LanguageSelect value={language} onChange={setLanguage} variant="overlay" />
            )}
            <ThemeToggle variant="overlay" />
          </div>
        </div>

        {/* Who is who. Your own pill is tappable, for when the phone changes
            hands mid-call and the person holding it is now the other role. */}
        <div className="pointer-events-auto mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={flipRole}
            aria-label="Switch your role"
            className={
              'pill chrome-plate '
              + (myRole === ROLE_SIGNER ? 'text-primary' : 'text-secondary')
            }
          >
            {myRole === ROLE_SIGNER ? <Hand size={11} /> : <Ear size={11} />}
            YOU · {myRole === ROLE_SIGNER ? 'SIGN' : 'SPEAK'}
          </button>

          <span className={'pill chrome-plate ' + (peerRole ? 'text-ink' : 'text-ink-dim')}>
            {(peerRole || contact?.role) === ROLE_SPEAKER ? <Ear size={11} /> : <Hand size={11} />}
            THEM · {peerRole
              ? (peerRole === ROLE_SIGNER ? 'SIGN' : 'SPEAK')
              : (linkReady ? 'SYNCING' : 'ASSUMED')}
          </span>

          {listeningActive && (
            <span
              className={
                'pill chrome-plate '
                + (sttState === 'listening' ? 'text-primary' : 'text-amber')
              }
            >
              <Mic size={11} />
              {sttState === 'listening' ? 'HEARING YOU' : sttState.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* Captions. Suppressed entirely between two signers: the whole point of
          that pairing is an unobstructed view of the hands. */}
      {captions && !cleanVideo && live && (
        <div className="pointer-events-none absolute inset-x-3 bottom-28 z-20 space-y-2">
          {relay === 'sign-to-speech' && (
            <>
              <CaptionCard
                label="THEM (SPEAKING)"
                tone="primary"
                text={incomingSpeech}
                placeholder="Waiting for them to speak…"
                large
              />
              <CaptionCard
                label={source === 'studio' ? 'YOU (ISL STUDIO)' : 'YOU (SIGNING)'}
                tone="secondary"
                text={studioPartial || signerLine}
                placeholder={source === 'studio'
                  ? (studioReady ? 'Sign, then FULL STOP to send the sentence…' : 'ISL Studio has no FULL STOP sign yet.')
                  : 'Sign to caption…'}
              />
            </>
          )}

          {relay === 'speech-to-sign' && (
            <>
              <CaptionCard
                label="THEM (SIGNING)"
                tone="primary"
                text={incomingSign}
                placeholder="Waiting for their signs…"
                large
              />
              <CaptionCard
                label="YOU (SPEAKING)"
                tone="secondary"
                text={mySpeech}
                placeholder={sttState === 'listening'
                  ? 'Listening…'
                  : 'Speech captions are not running.'}
              />
            </>
          )}

          {relay === 'voice' && (
            <p className="px-1 text-[10px] text-ink-dim">
              Both ends are hearing users — an ordinary call, with no
              translation running.
            </p>
          )}
        </div>
      )}

      {diagnostic && (
        <p className="absolute inset-x-4 bottom-24 z-40 rounded-lg bg-black/75 px-3 py-2 text-center text-xs text-amber backdrop-blur">
          {diagnostic.message}
        </p>
      )}

      {/* Bottom dock */}
      <div className="absolute inset-x-0 bottom-0 z-40 scrim-bottom pb-7 pt-10">
        <div className="flex items-center justify-center gap-3.5">
          <CallButton onClick={toggleMute} active={!muted} label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </CallButton>

          <CallButton
            onClick={swap}
            active={swapped}
            tint="secondary"
            label="Swap the main and mini video"
          >
            <Repeat size={20} />
          </CallButton>

          <button
            type="button"
            onClick={() => endCall()}
            aria-label="End call"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-rose shadow-[0_0_28px_-4px_rgba(244,63,94,0.8)] active:scale-95"
          >
            <PhoneOff size={26} className="text-white" />
          </button>

          <CallButton
            onClick={() => cameraManager.flip()}
            active={false}
            label={mirrored ? 'Switch to back camera' : 'Switch to front camera'}
          >
            <SwitchCamera size={20} />
          </CallButton>

          {myRole === ROLE_SPEAKER ? (
            <CallButton
              onClick={toggleVoiceOut}
              active={voiceOut}
              tint="secondary"
              label={voiceOut ? 'Stop speaking their signs' : 'Speak their signs aloud'}
            >
              {voiceOut ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </CallButton>
          ) : (
            <CallButton
              onClick={() => setCaptions((v) => !v)}
              active={captions}
              tint="secondary"
              label="Captions"
            >
              <Captions size={20} />
            </CallButton>
          )}
        </div>
      </div>
    </div>
  );
}

function CaptionCard({ label, tone, text, placeholder, large = false }) {
  return (
    <div className="rounded-2xl chrome-plate px-4 py-2.5">
      <p className={
        'text-[10px] font-bold tracking-wide '
        + (tone === 'primary' ? 'text-primary' : 'text-secondary')
      }>
        {label}
      </p>
      <p className={
        (large ? 'text-base' : 'text-sm') + ' leading-snug '
        + (text ? 'text-ink' : 'text-ink-dim')
      }>
        {text || placeholder}
      </p>
    </div>
  );
}

/**
 * A round dock control over live video.
 *
 * The OFF state is the one that breaks: a white-at-15% ghost is legible on a
 * dark dock and completely invisible on a light one, so it inverts with the
 * theme (.chrome-ghost) rather than staying white. The ON state is a solid
 * fill, which needs no such help.
 */
function CallButton({ children, onClick, active, tint = 'ink', label }) {
  const on = tint === 'secondary'
    ? 'bg-secondary text-white'
    : 'bg-slate-900 text-white dark:bg-white/90 dark:text-slate-900';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={
        'flex h-12 w-12 items-center justify-center rounded-full '
        + 'backdrop-blur transition active:scale-95 '
        + (active ? on : 'chrome-ghost')
      }
    >
      {children}
    </button>
  );
}
