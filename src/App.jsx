import { useCallback, useEffect, useState } from 'react';
import Dashboard from './views/Dashboard.jsx';
import SignTranslator from './views/SignTranslator.jsx';
import HearingMode from './views/HearingMode.jsx';
import VideoCall from './views/VideoCall.jsx';
import Settings from './views/Settings.jsx';
import cameraManager from './services/cameraManager.js';
import { DEFAULT_LANGUAGE_CODE } from './config/languages.js';
import { getMode, toggleMode } from './services/translationService.js';

/**
 * Shell and router.
 *
 * Views are swapped by state, not by a router that remounts trees. The camera
 * is started once here and handed around by cameraManager, so moving between
 * Dashboard, Sign Translator and Video Call re-parents one <video> element
 * rather than re-acquiring the stream.
 */
export default function App() {
  const [view, setView] = useState('dashboard');
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

  useEffect(() => {
    try {
      localStorage.setItem('isl.language', language);
    } catch { /* private mode */ }
  }, [language]);

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

  // Acquire the camera when a camera view is first opened, and keep it.
  const needsCamera = view === 'sign' || view === 'call';
  useEffect(() => {
    if (!needsCamera) return;
    cameraManager.start().catch((err) => setCameraError(err.message));
  }, [needsCamera]);

  const go = useCallback((next) => setView(next), []);

  const shared = {
    language, setLanguage, online, mode, togglePipeline,
    onBack: () => go('dashboard'),
  };

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-surface">
      {view === 'dashboard' && <Dashboard {...shared} onNavigate={go} />}
      {view === 'sign' && <SignTranslator {...shared} cameraError={cameraError} />}
      {view === 'hearing' && <HearingMode {...shared} />}
      {view === 'call' && <VideoCall {...shared} cameraError={cameraError} />}
      {view === 'settings' && <Settings {...shared} />}
    </div>
  );
}
