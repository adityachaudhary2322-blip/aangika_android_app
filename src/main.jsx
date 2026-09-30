import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { CallProvider } from './context/CallContext.jsx';
import './index.css';
import { armAudioUnlock } from './services/ttsService.js';
import setupNative from './native/index.js';
// Early, so the one-shot beforeinstallprompt event is never missed.
import './services/pwa.js';

// Mobile browsers refuse programmatic audio until the user has interacted with
// the page. Arm one-shot listeners now so the first tap anywhere unlocks
// playback for the rest of the session.
armAudioUnlock();

// Android app only: native Bluetooth for the glove, back button, splash.
setupNative();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      {/* CallProvider sits above the router so the Peer registration outlives
          every view and a call can arrive while the user is anywhere. */}
      <CallProvider>
        {/* Last line of defence: never a blank page. */}
        <ErrorBoundary name="Aangika" onReset={() => window.location.reload()} resetLabel="Reload the app">
          <App />
        </ErrorBoundary>
      </CallProvider>
    </ThemeProvider>
  </React.StrictMode>
);
