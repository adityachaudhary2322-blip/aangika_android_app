import { Home, Hand, MessageCircle, Settings as SettingsIcon } from 'lucide-react';

/**
 * The app's primary navigation.
 *
 * Only the four top-level destinations live here. Deeper screens (Hearing
 * Mode, Recorded Video, My signs) are reached from Home and keep their own
 * back button, and the bar hides on them so the camera and captions get the
 * full height.
 */
const ITEMS = [
  { id: 'dashboard', label: 'Home', Icon: Home },
  { id: 'sign', label: 'Translate', Icon: Hand },
  { id: 'messenger', label: 'Messages', Icon: MessageCircle },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function BottomNav({ view, onNavigate, unread = 0 }) {
  return (
    <nav
      aria-label="Primary"
      data-tour="nav"
      className="glass mx-3 mb-3 flex items-stretch justify-around rounded-3xl px-1 py-1.5 shadow-card"
    >
      {ITEMS.map(({ id, label, Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={active ? 'page' : undefined}
            className={
              'relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 '
              + 'text-[10px] font-semibold transition '
              + (active ? 'text-primary' : 'text-ink-dim hover:text-ink')
            }
          >
            <span
              className={
                'flex h-8 w-12 items-center justify-center rounded-full transition '
                + (active ? 'bg-primary/15' : '')
              }
            >
              <Icon size={19} strokeWidth={active ? 2.4 : 2} />
            </span>
            {label}
            {id === 'messenger' && unread > 0 && (
              <span className="absolute right-[22%] top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose px-1 text-[9px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
