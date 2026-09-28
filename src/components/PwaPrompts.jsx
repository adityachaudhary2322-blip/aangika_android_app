import { useEffect, useState } from 'react';
import { Download, RefreshCw, Share, WifiOff, X, PlusSquare } from 'lucide-react';
import BrandMark from './BrandMark.jsx';
import {
  subscribe, canInstall, promptInstall, isIOS, applyUpdate,
} from '../services/pwa.js';

const SNOOZE_KEY = 'isl.install.snoozedUntil';
const SNOOZE_DAYS = 7;

function snoozed() {
  try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now(); } catch { return false; }
}

/**
 * The three app-level notices, bottom-left on desktop and above the tab bar
 * on a phone:
 *   - "Install Aangika", a few seconds after load, until installed or
 *     snoozed for a week. iOS gets Add to Home Screen instructions instead.
 *   - "A new version is ready", with a reload button.
 *   - "You're offline", with what still works.
 */
export default function PwaPrompts({ online, raised }) {
  const [pwa, setPwa] = useState({});
  const [showInstall, setShowInstall] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const [offlineNote, setOfflineNote] = useState(false);

  useEffect(() => subscribe(setPwa), []);

  useEffect(() => {
    if (snoozed()) return undefined;
    const id = setTimeout(() => setShowInstall(true), 8000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (online) { setOfflineNote(false); return undefined; }
    setOfflineNote(true);
    const id = setTimeout(() => setOfflineNote(false), 9000);
    return () => clearTimeout(id);
  }, [online]);

  const snooze = () => {
    setShowInstall(false);
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5)); } catch { /* private mode */ }
  };

  const install = async () => {
    if (isIOS() && !pwa.installEvent) { setIosHelp(true); return; }
    const outcome = await promptInstall();
    if (outcome !== 'unavailable') setShowInstall(false);
  };

  const installable = showInstall && canInstall();
  // On a phone the right edge is left for Mudra, who lives in that corner.
  const place = 'fixed left-3 right-[4.75rem] z-40 sm:left-4 sm:right-auto sm:w-[22rem] lg:bottom-6 lg:left-[17rem] '
    + (raised ? 'bottom-[5.75rem]' : 'bottom-4');

  return (
    <>
      {pwa.needRefresh && (
        <div className={place + ' animate-pop-in flex items-center gap-3 rounded-3xl border border-subtle bg-card p-3 pl-4 shadow-card'}>
          <RefreshCw size={18} className="shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm">A new version of Aangika is ready.</p>
          <button type="button" onClick={applyUpdate} className="btn-primary px-3 py-2 text-xs">Reload</button>
        </div>
      )}

      {!pwa.needRefresh && offlineNote && (
        <div className={place + ' animate-pop-in flex items-start gap-3 rounded-3xl border border-amber/30 bg-card p-3 pl-4 shadow-card'}>
          <WifiOff size={18} className="mt-0.5 shrink-0 text-amber" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed">
            <b className="text-sm">You’re offline.</b><br />
            Sign recognition, the offline grammar, phrases, your signs and the
            word list still work. Speech, voices and calls come back with the
            connection.
          </p>
          <button type="button" onClick={() => setOfflineNote(false)} aria-label="Dismiss" className="btn-icon h-7 w-7">
            <X size={13} />
          </button>
        </div>
      )}

      {!pwa.needRefresh && !offlineNote && installable && (
        <div className={place + ' animate-pop-in rounded-3xl border border-subtle bg-card p-4 shadow-card'}>
          <div className="flex items-start gap-3">
            <BrandMark size={44} />
            <div className="min-w-0 flex-1">
              <p className="display text-lg leading-tight">Install Aangika</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">
                Opens full screen from your home screen, and keeps working
                when you’re offline.
              </p>
            </div>
            <button type="button" onClick={snooze} aria-label="Not now" className="btn-icon h-7 w-7">
              <X size={13} />
            </button>
          </div>
          {iosHelp ? (
            <ol className="mt-3 space-y-1.5 rounded-2xl bg-card-high p-3 text-xs">
              <li className="flex items-center gap-2">1. Tap <Share size={14} className="text-primary" /> Share in Safari’s toolbar</li>
              <li className="flex items-center gap-2">2. Choose <PlusSquare size={14} className="text-primary" /> Add to Home Screen</li>
              <li>3. Tap Add</li>
            </ol>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={install} className="btn-primary flex-1 py-2.5">
                <Download size={15} /> Install app
              </button>
              <button type="button" onClick={snooze} className="btn-quiet py-2.5">Not now</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
