import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { CallProvider } from './context/CallContext.jsx';
import './index.css';
import { armAudioUnlock } from './services/ttsService.js';

// Mobile browsers refuse programmatic audio until the user has interacted with
// the page. Arm one-shot listeners now so the first tap anywhere unlocks
// playback for the rest of the session.
armAudioUnlock();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      {/* CallProvider sits above the router so the Peer registration outlives
          every view and a call can arrive while the user is anywhere. */}
      <CallProvider>
        <App />
      </CallProvider>
    </ThemeProvider>
  </React.StrictMode>
);
