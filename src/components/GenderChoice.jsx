import { useEffect, useState } from 'react';
import prefs, { getGender, setGender } from '../services/signerPrefs.js';

/**
 * "I am: Male / Female" for translations in the signer's voice: Hindi first
 * person ("मैं खाता हूँ" / "मैं खाती हूँ") and the default voice. Kept on this
 * device; no sign-in needed.
 */
export default function GenderChoice({ className = '' }) {
  const [g, setG] = useState(() => getGender());
  useEffect(() => prefs.subscribe((s) => setG(s.gender)), []);
  return (
    <section className={'surface-card p-4 ' + className} aria-label="Your gender for translations">
      <p className="eyebrow">You (for translations)</p>
      <p className="mt-1 text-[11px] text-ink-dim">
        Hindi changes with who is speaking: “मैं खाता हूँ” (male) or “मैं खाती हूँ” (female). Your signs are translated
        in your form{g ? '' : ' (male until you choose)'}, and spoken in a matching voice. Kept on this device; no sign-in needed.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-card-high p-1">
        {[['male', 'Male · मैं खाता हूँ'], ['female', 'Female · मैं खाती हूँ']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setG(setGender(id))}
            aria-pressed={g === id}
            className={'rounded-xl py-2 text-sm font-semibold transition ' + (g === id ? 'bg-card text-ink shadow-card' : 'text-ink-dim hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
