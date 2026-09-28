import {
  Home, Hand, Mic, MessageCircle, Quote, BookOpen, Sparkles, FileVideo,
  Settings as SettingsIcon,
} from 'lucide-react';
import BrandMark from './BrandMark.jsx';
import ThemeToggle from './ThemeToggle.jsx';

/**
 * Desktop navigation. On a wide screen every destination is one click away,
 * so the rail lists them all, grouped; phones keep the four-tab bar.
 */
const GROUPS = [
  {
    label: null,
    items: [{ id: 'dashboard', label: 'Home', Icon: Home }],
  },
  {
    label: 'Translate',
    items: [
      { id: 'sign', label: 'Sign to speech', Icon: Hand },
      { id: 'hearing', label: 'Speech to text', Icon: Mic },
      { id: 'recorded', label: 'Recorded video', Icon: FileVideo },
    ],
  },
  {
    label: 'Connect',
    items: [{ id: 'messenger', label: 'Messages', Icon: MessageCircle }],
  },
  {
    label: 'Your language',
    items: [
      { id: 'phrases', label: 'Phrases', Icon: Quote },
      { id: 'mysigns', label: 'My signs', Icon: Sparkles },
      { id: 'words', label: 'Word list', Icon: BookOpen },
    ],
  },
];

export default function SideNav({ view, onNavigate, unread = 0 }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-subtle bg-card/60 px-3 py-5 backdrop-blur-xl lg:flex">
      <button
        type="button"
        onClick={() => onNavigate('dashboard')}
        className="flex items-center gap-2.5 px-2"
      >
        <BrandMark size={34} />
        <span className="text-left leading-tight">
          <span className="display block text-lg">Aangika</span>
          <span className="block text-[11px] text-ink-dim">Indian Sign Language</span>
        </span>
      </button>

      <nav aria-label="Primary" data-tour="nav" className="mt-6 flex-1 space-y-5 overflow-y-auto no-scrollbar">
        {GROUPS.map((g, gi) => (
          <div key={gi}>
            {g.label && <p className="eyebrow mb-1.5 px-3">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map(({ id, label, Icon }) => {
                const active = view === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(id)}
                      aria-current={active ? 'page' : undefined}
                      className={
                        'relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition '
                        + (active
                          ? 'bg-primary/10 text-primary'
                          : 'text-ink-dim hover:bg-card-high hover:text-ink')
                      }
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" />
                      )}
                      <Icon size={17} strokeWidth={active ? 2.3 : 1.9} />
                      {label}
                      {id === 'messenger' && unread > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rose px-1.5 text-[10px] font-bold text-white">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-4 flex items-center gap-2 border-t border-subtle px-1 pt-4">
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          aria-current={view === 'settings' ? 'page' : undefined}
          className={
            'flex flex-1 items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium transition '
            + (view === 'settings' ? 'bg-primary/10 text-primary' : 'text-ink-dim hover:bg-card-high hover:text-ink')
          }
        >
          <SettingsIcon size={17} /> Settings
        </button>
        <ThemeToggle />
      </div>
    </aside>
  );
}
