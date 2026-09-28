import { useCallback, useEffect, useState } from 'react';
import Dashboard from './views/Dashboard.jsx';
import MessengerView from './views/MessengerView.jsx';
import SignTranslator from './views/SignTranslator.jsx';
import HearingMode from './views/HearingMode.jsx';
import VideoCall from './views/VideoCall.jsx';
import Settings from './views/Settings.jsx';
import RecordedVideoTranslator from './views/RecordedVideoTranslator.jsx';
import MySigns from './views/MySigns.jsx';
import {
  init as initCustomSigns, setReservedTokens, migrateFromVocab,
} from './services/customSigns.js';
import { fillPendingTranslations } from './services/customSignTranslations.js';
import IncomingCall from './components/IncomingCall.jsx';
import { useCall } from './context/CallContext.jsx';
import cameraManager from './services/cameraManager.js';
import { DEFAULT_LANGUAGE_CODE } from './config/languages.js';
import { setMode as setModeInternal } from './services/translationService.js';
import { getMode, toggleMode } from './services/translationService.js';
import {
  getVisionEngine, setVisionEngine,
  getGrammarEngine, setGrammarEngine, grammarToPipelineMode,
} from './services/engineState.js';

/**
 * Shell and router.
 *
 * Views are swapped by state, not by a router that remounts trees. The camera
 * is started once here and handed around by cameraManager, so moving between
 * Messenger, Sign Translator and a live call re-parents one <video> element
 * rather than re-acquiring the stream.
 *
 * THE CALL IS NOT A VIEW. It is an overlay above the router, driven by
 * CallContext, because a call can arrive while the user is anywhere — reading
 * a chat, in Settings, mid-translation. Routing to it would lose whatever they
 * were doing; layering over it means hanging up returns them to the exact
 * screen they were on, which for an outgoing call is the chat they dialled
 * from.
 */
export default function App() {
  const { call } = useCall();
  const [view, setView] = useState('messenger');
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem('isl.language') || DEFAULT_LANGUAGE_CODE;
    } catch {
      return DEFAULT_LANGUAGE_CODE;
    }
  });
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [cameraError, setCameraError] = useState(null);
  const [mode, setModeState] = useState(() => getMode());

  // The offline tile flips the whole translation pipeline, so the choice
  // lives here and every view reads the same value.
  const togglePipeline = useCallback(() => setModeState(toggleMode()), []);

  const [visionEngine, setVisionState] = useState(() => getVisionEngine());
  const [grammarEngine, setGrammarState] = useState(() => getGrammarEngine());

  const chooseVision = useCallback((id) => setVisionState(setVisionEngine(id)), []);

  // The grammar choice and translationService's online/offline mode are two
  // views of one decision, so keep them in step rather than letting the badge
  // disagree with what actually runs.
  const chooseGrammar = useCallback((id) => {
    const next = setGrammarEngine(id);
    setGrammarState(next);
    setModeState(setModeInternal(grammarToPipelineMode(next)));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('isl.language', language);
    } catch { /* private mode */ }
  }, [language]);

  // "My signs": load the library, reserve the model's words so a taught sign
  // can never shadow one, migrate vocab.json's custom_signs once, and finish
  // any sentence translations that were saved while offline.
  useEffect(() => {
    (async () => {
      try {
        await initCustomSigns();
        const vocab = await fetch('/models/vocab.json').then((r) => (r.ok ? r.json() : null));
        if (vocab) {
          setReservedTokens(vocab.words || []);
          await migrateFromVocab(vocab);
        }
      } catch (err) {
        console.warn('[custom signs] bootstrap', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (online) fillPendingTranslations().catch(() => {});
  }, [online]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Acquire the camera when a camera view is first opened, and keep it. A call
  // counts wherever the user happens to be standing when it starts.
  const inCall = call.status === 'live' || call.status === 'dialling'
    || call.status === 'preparing';
  const needsCamera = view === 'sign' || view === 'mysigns' || inCall;
  useEffect(() => {
    if (!needsCamera) return;
    cameraManager.start().catch((err) => setCameraError(err.message));
  }, [needsCamera]);

  // "My signs" is opened from both the translator and Settings; Back returns
  // to whichever one opened it.
  const [returnTo, setReturnTo] = useState('dashboard');
  const go = useCallback((next) => {
    setView((cur) => {
      if (next === 'mysigns' && cur !== 'mysigns') setReturnTo(cur);
      return next;
    });
  }, []);

  const shared = {
    language, setLanguage, online, mode, togglePipeline,
    visionEngine, chooseVision, grammarEngine, chooseGrammar,
    onBack: () => go('dashboard'),
  };

  return (
    <>
      {/* The messenger is wider than the other views: two panes need the room,
          and clamping it to a phone width would waste a desktop screen. */}
      <div
        className={
          'mx-auto flex h-full flex-col bg-surface '
          + (view === 'messenger' ? 'max-w-3xl' : 'max-w-md')
        }
      >
        {view === 'messenger' && <MessengerView onNavigate={go} />}
        {view === 'dashboard' && <Dashboard {...shared} onNavigate={go} />}
        {view === 'sign' && (
          <SignTranslator {...shared} cameraError={cameraError} onNavigate={go} />
        )}
        {view === 'mysigns' && (
          <MySigns {...shared} cameraError={cameraError} onBack={() => go(returnTo)} />
        )}
        {view === 'hearing' && <HearingMode {...shared} />}
        {view === 'recorded' && <RecordedVideoTranslator {...shared} />}
        {view === 'settings' && <Settings {...shared} onNavigate={go} />}
      </div>

      {/* Above the router, in ringing order: an unanswered call first, then the
          call surface itself once it is dialling or up. */}
      <IncomingCall />
      {inCall && (
        <VideoCall
          language={language}
          setLanguage={setLanguage}
          mode={mode}
          visionEngine={visionEngine}
          chooseVision={chooseVision}
        />
      )}
    </>
  );
}
