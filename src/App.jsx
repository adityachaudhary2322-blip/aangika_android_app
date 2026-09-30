import { useCallback, useEffect, useMemo, useState } from 'react';
import Dashboard from './views/Dashboard.jsx';
import MessengerView from './views/MessengerView.jsx';
import SignTranslator from './views/SignTranslator.jsx';
import AslTranslator from './views/AslTranslator.jsx';
import HearingMode from './views/HearingMode.jsx';
import VideoCall from './views/VideoCall.jsx';
import Settings from './views/Settings.jsx';
import RecordedVideoTranslator from './views/RecordedVideoTranslator.jsx';
import MySigns from './views/MySigns.jsx';
import DemoMode from './views/DemoMode.jsx';
import ReviewContributions from './views/ReviewContributions.jsx';
import DeveloperDictionary from './views/DeveloperDictionary.jsx';
import IslStudio from './views/IslStudio.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { resetLocal as resetIslStudio } from './services/isl/islDictionary.js';
import { checkForUpdates } from './services/modelUpdates.js';
import { flush as flushContributions } from './services/contributions.js';
import { checkForUpdates as checkDictionary } from './services/sharedDictionary.js';
import { installGloveSim } from './services/glove/sim.js';

// Simulated glove for tests / development (only with ?glove=sim in the URL).
installGloveSim();
import WordList from './views/WordList.jsx';
import Phrases from './views/Phrases.jsx';
import Meet from './views/Meet.jsx';
import {
  init as initCustomSigns, setReservedTokens, prunePlaceholders,
} from './services/customSigns.js';
import { fillPendingTranslations } from './services/customSignTranslations.js';
import IncomingCall from './components/IncomingCall.jsx';
import BottomNav from './components/BottomNav.jsx';
import SideNav from './components/SideNav.jsx';
import Ambient from './components/Ambient.jsx';
import Mascot from './components/Mascot.jsx';
import PwaPrompts from './components/PwaPrompts.jsx';
import * as chatStore from './services/chatStorage.js';
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
  const { call, revision } = useCall();
  // Home first. Messaging needs a profile, but nothing else does, so the
  // profile form waits inside the Messages tab instead of gating the app.
  // `?view=` comes from the manifest's home-screen shortcuts; `?room=` is a
  // meeting invite link and opens Meet with the code filled in.
  const [initialRoom] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('room') || ''; } catch { return ''; }
  });
  const [view, setView] = useState(() => {
    if (initialRoom) return 'meet';
    try {
      const v = new URLSearchParams(window.location.search).get('view');
      return ['sign', 'asl', 'isl', 'hearing', 'messenger', 'meet'].includes(v) ? v : 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  const [meetLive, setMeetLive] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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
  // can never shadow one, drop old untrained vocab.json placeholders (My signs
  // is only what the user taught), and finish any sentence translations that
  // were saved while offline.
  useEffect(() => {
    (async () => {
      try {
        await initCustomSigns();
        const vocab = await fetch('/models/vocab.json').then((r) => (r.ok ? r.json() : null));
        if (vocab) {
          setReservedTokens(vocab.words || []);
          await prunePlaceholders();
        }
        // Community dictionary: signs developers shared with everyone.
        checkDictionary().catch(() => {});
      } catch (err) {
        console.warn('[custom signs] bootstrap', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (online) fillPendingTranslations().catch(() => {});
    // Approved model releases (models/index.json), downloaded in the background.
    if (online) checkForUpdates().catch(() => {});
    // Consented samples waiting on this device, if signed in.
    if (online) flushContributions().catch(() => {});
    // Back online: pick up any signs published while offline.
    if (online) checkDictionary().catch(() => {});
  }, [online]);

  // Left open for a long time: look for newly shared signs every 15 minutes
  // (a 304 when nothing changed, so this costs almost nothing).
  useEffect(() => {
    if (!online) return undefined;
    const id = setInterval(() => checkDictionary().catch(() => {}), 15 * 60 * 1000);
    return () => clearInterval(id);
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
  const needsCamera = view === 'sign' || view === 'asl' || view === 'isl' || view === 'mysigns' || view === 'demo' || inCall;
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

  // Android back button (the Capacitor app dispatches 'aangika:back'): step
  // back to Home from any screen; on Home, let the app close.
  useEffect(() => {
    const onBack = (e) => {
      if (view === 'dashboard' || view === 'messenger') {
        e.detail?.exit?.();
        return;
      }
      go(view === 'mysigns' ? returnTo : ['demo', 'developer', 'review'].includes(view) ? 'settings' : 'dashboard');
    };
    window.addEventListener('aangika:back', onBack);
    return () => window.removeEventListener('aangika:back', onBack);
  }, [view, returnTo, go]);

  const unread = useMemo(
    () => chatStore.getContacts().reduce((n, c) => n + (c.unread || 0), 0),
    [revision]
  );

  // The tab bar shows on the top-level screens only. Camera views need the
  // height, and an open chat needs the composer at the bottom edge.
  const showNav = view === 'dashboard' || view === 'settings'
    || (view === 'messenger' && !chatOpen) || (view === 'meet' && !meetLive);

  const shared = {
    language, setLanguage, online, mode, togglePipeline,
    visionEngine, chooseVision, grammarEngine, chooseGrammar,
    onBack: () => go('dashboard'),
  };

  // Content width per view. Phones get the full width everywhere; on a wide
  // screen reading views stay at a comfortable measure, while the camera and
  // the two-pane messenger take the room they can use.
  const width = {
    messenger: 'max-w-3xl lg:max-w-6xl',
    meet: meetLive ? 'max-w-none' : 'max-w-md lg:max-w-4xl',
    sign: 'max-w-md lg:max-w-none',
    asl: 'max-w-md lg:max-w-none',
    isl: 'max-w-md lg:max-w-3xl',
    dashboard: 'max-w-md lg:max-w-5xl',
  }[view] || 'max-w-md lg:max-w-3xl';

  return (
    <>
      <Ambient />
      <div className="flex h-full">
        <SideNav view={view} onNavigate={go} unread={unread} />
        <div className={'mx-auto flex h-full w-full min-w-0 flex-col ' + width}>
          <div key={view} className="flex min-h-0 flex-1 animate-fade-up flex-col">
            {/* Any screen that crashes shows its error here; the rest of the app keeps working. */}
            <ErrorBoundary name="This screen" onReset={() => go('dashboard')} resetLabel="Go home">
            {view === 'messenger' && (
              <MessengerView onNavigate={go} onChatOpenChange={setChatOpen} />
            )}
            {view === 'dashboard' && <Dashboard {...shared} onNavigate={go} />}
            {view === 'sign' && (
              <SignTranslator {...shared} cameraError={cameraError} onNavigate={go} />
            )}
            {view === 'asl' && (
              <AslTranslator {...shared} cameraError={cameraError} onNavigate={go} />
            )}
            {view === 'mysigns' && (
              <MySigns {...shared} cameraError={cameraError} onBack={() => go(returnTo)} onNavigate={go} />
            )}
            {view === 'isl' && (
              <ErrorBoundary name="ISL Studio" onReset={resetIslStudio} resetLabel="Clear this device's ISL Studio copy and reload the team dictionary">
                <IslStudio onBack={() => go('dashboard')} language={language} mode={mode} />
              </ErrorBoundary>
            )}
            {view === 'developer' && (
              <DeveloperDictionary onBack={() => go('settings')} onNavigate={go} />
            )}
            {view === 'hearing' && <HearingMode {...shared} />}
            {view === 'recorded' && <RecordedVideoTranslator {...shared} />}
            {view === 'settings' && <Settings {...shared} onNavigate={go} />}
            {view === 'words' && <WordList {...shared} onNavigate={go} />}
            {view === 'phrases' && <Phrases {...shared} cameraError={cameraError} />}
        {view === 'review' && <ReviewContributions onBack={() => go('settings')} />}
        {view === 'demo' && (
          <DemoMode {...shared} cameraError={cameraError} onBack={() => go('settings')} />
        )}
            {view === 'meet' && (
              <Meet {...shared} initialCode={initialRoom} onLiveChange={setMeetLive} />
            )}
            </ErrorBoundary>
          </div>
          {showNav && (
            <div className="lg:hidden">
              <BottomNav view={view} onNavigate={go} unread={unread} />
            </div>
          )}
        </div>
      </div>

      {!inCall && !(view === 'meet' && meetLive) && view !== 'sign' && view !== 'asl' && (
        <PwaPrompts online={online} raised={showNav} />
      )}

      {/* The guide stays out of the way of the camera and of a call. */}
      {!inCall && (
        <Mascot
          view={view}
          onNavigate={go}
          raised={showNav}
          hidden={view === 'sign' || view === 'asl' || view === 'isl' || view === 'mysigns' || (view === 'messenger' && chatOpen)
            || (view === 'meet' && meetLive)}
        />
      )}

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
