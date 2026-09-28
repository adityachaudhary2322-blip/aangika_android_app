/**
 * What the guide (Mudra, the mascot) knows.
 *
 * Deliberately local and deterministic: questions are matched against
 * keywords, so the guide works offline, instantly, and never invents an
 * answer. Each entry can offer actions: `go` opens a screen, `palette`
 * switches the theme.
 */

export const TOPICS = [
  {
    id: 'sign',
    title: 'Translate my signing',
    keys: ['sign to speech', 'translate sign', 'camera', 'recognis', 'recogniz', 'signing', 'start translating', 'how do i sign'],
    answer:
      'Open Sign to speech and tap Start. Stand where your hands and shoulders are in view, then hold each sign for a moment: it is spoken automatically. Several signs in a row build a sentence you can translate as a whole.',
    actions: [{ label: 'Open Sign to speech', go: 'sign' }],
  },
  {
    id: 'hearing',
    title: 'Read what someone says',
    keys: ['speech', 'hear', 'caption', 'transcri', 'listen', 'voice', 'microphone', 'mic'],
    answer:
      'Speech to text listens to the person talking and writes it down as a conversation. You can reply by typing, or tap a quick reply, and it is read aloud for them. Save the whole conversation as notes when you are done.',
    actions: [{ label: 'Open Speech to text', go: 'hearing' }],
  },
  {
    id: 'phrases',
    title: 'Teach a whole sentence',
    keys: ['phrase', 'sentence', 'continuous', 'sequence', 'several signs', 'multiple signs', 'in a row', 'whole'],
    answer:
      'Phrases turn a sequence of signs into one sentence you choose. Record yourself signing, say HELLO then NAME then ADITYA, and give it a meaning like "Hi, I\'m Aditya". When the translator sees that sequence it speaks your sentence. In the translator, "Save as phrase" does the same from what you just signed.',
    actions: [{ label: 'Open Phrases', go: 'phrases' }],
  },
  {
    id: 'mysigns',
    title: 'Add my own sign',
    keys: ['teach', 'my sign', 'custom', 'add sign', 'add a sign', 'new sign', 'own sign', 'name sign', 'record a sign'],
    answer:
      'My signs lets you teach a handshape for a word or a name the app does not know. Record it three times, choose what it means, and it works straight away in SignBridge mode. Only signs you add appear there.',
    actions: [{ label: 'Open My signs', go: 'mysigns' }],
  },
  {
    id: 'words',
    title: 'Which words does it know?',
    keys: ['word list', 'which word', 'vocab', 'dictionary', 'know', 'understand', 'what words', 'supported'],
    answer:
      'The Word list shows every sign Aangika can recognise, about 1,500 words, in one A-Z list with your own signs mixed in. Search it before you sign something unusual.',
    actions: [{ label: 'Open Word list', go: 'words' }],
  },
  {
    id: 'messages',
    title: 'Call or chat with a friend',
    keys: ['call', 'video', 'friend', 'chat', 'message', 'handle', 'contact', 'profile', 'login', 'sign up', 'account'],
    answer:
      'Messages needs one thing: a handle, which is your address. There are no accounts or passwords. Add a friend by their handle, then chat or start a video call; captions of your signing appear for them during the call.',
    actions: [{ label: 'Open Messages', go: 'messenger' }],
  },
  {
    id: 'themes',
    title: 'Change the look',
    keys: ['theme', 'colour', 'color', 'dark', 'light', 'cherry', 'blossom', 'sakura', 'autumn', 'fall', 'winter', 'snow', 'firefl', 'appearance', 'look', 'animat', 'background'],
    answer:
      'Pick a palette in Settings → Appearance, or choose your own colour. The seasonal ones are animated: petals, leaves, snow or fireflies drift behind the app and move away from your finger. Want to try one now?',
    actions: [
      { label: 'Cherry blossom', palette: 'sakura' },
      { label: 'Autumn', palette: 'autumn' },
      { label: 'Winter', palette: 'winter' },
      { label: 'Fireflies', palette: 'fireflies' },
      { label: 'All options', go: 'settings' },
    ],
  },
  {
    id: 'accuracy',
    title: 'It gets my signs wrong',
    keys: ['wrong', 'not work', "doesn't work", 'does not work', 'accura', 'bad', 'mistake', 'not recogn', 'improve', 'better'],
    answer:
      'A few things help most: good front light, your hands and shoulders fully in frame, one clear sign at a time with a short pause between. The model gets roughly one word in four right today, so trust the word chips more than the sentence. For words you use often, teach them as your own signs.',
    actions: [{ label: 'Teach a sign', go: 'mysigns' }, { label: 'Word list', go: 'words' }],
  },
  {
    id: 'offline',
    title: 'Does it work offline?',
    keys: ['offline', 'internet', 'network', 'wifi', 'data', 'no connection'],
    answer:
      'Sign recognition runs on your device, and the offline engine builds sentences without any network. Speech to text, cloud voices and translation into other languages need a connection. Toggle the engine from Home.',
    actions: [{ label: 'Go Home', go: 'dashboard' }],
  },
  {
    id: 'language',
    title: 'Change the spoken language',
    keys: ['language', 'hindi', 'tamil', 'telugu', 'bengali', 'marathi', 'gujarati', 'kannada', 'malayalam', 'punjabi', 'odia', 'english'],
    answer:
      'Aangika speaks 11 Indian languages. Pick one from the language button on Home or in the translator; your signs are spoken in that language.',
    actions: [{ label: 'Go Home', go: 'dashboard' }],
  },
  {
    id: 'recorded',
    title: 'Subtitle a video',
    keys: ['recorded', 'video file', 'subtitle', 'upload', 'srt', 'file'],
    answer:
      'Recorded video reads a video file of someone signing and produces subtitles you can download as an .srt file.',
    actions: [{ label: 'Open Recorded video', go: 'recorded' }],
  },
  {
    id: 'privacy',
    title: 'Is my data private?',
    keys: ['privacy', 'private', 'safe', 'store', 'server', 'secure', 'record me', 'upload my'],
    answer:
      'Your camera never leaves the device: landmarks are computed and recognised locally. Chats and calls go peer-to-peer. Only speech-to-text and cloud translation send data out, and only when you use them.',
    actions: [],
  },
  {
    id: 'install',
    title: 'Install as an app',
    keys: ['install', 'home screen', 'download app', 'app store', 'shortcut'],
    answer:
      'In Chrome or Edge, use "Install app" or "Add to Home screen" from the browser menu. Aangika then opens full screen, with shortcuts for Sign, Speech and Messages.',
    actions: [],
  },
  {
    id: 'mascot',
    title: 'Who are you?',
    keys: ['who are you', 'your name', 'mascot', 'mudra', 'hide you', 'go away', 'hide'],
    answer:
      'I\'m Mudra — the word for a hand gesture. I live in the corner and help when you ask. You can hide me in Settings → Appearance whenever you like.',
    actions: [{ label: 'Hide Mudra', hideMascot: true }],
  },
];

const SMALL_TALK = [
  { keys: ['thank', 'thanks', 'dhanyavad', 'shukriya'], answer: 'Any time! Tap me whenever you need a hand. 🙌' },
  { keys: ['hello', 'hi ', 'hey', 'namaste', 'good morning', 'good evening'], answer: 'Namaste! Ask me how anything works, or pick a question below.' },
];

/** Screen-specific opener and the questions most worth suggesting there. */
export const CONTEXT = {
  dashboard: { tip: 'Start with Sign to speech, or ask me how anything works.', suggest: ['sign', 'phrases', 'themes', 'messages'] },
  messenger: { tip: 'Pick a handle to start. It is your address, and there is no account to create.', suggest: ['messages', 'privacy', 'offline'] },
  hearing: { tip: 'Tap the big button and let them speak. Your typed replies are read aloud.', suggest: ['hearing', 'language', 'offline'] },
  phrases: { tip: 'Record a few signs in a row, then write what the whole thing means.', suggest: ['phrases', 'accuracy', 'words'] },
  words: { tip: 'Search a word to see whether the camera can recognise it.', suggest: ['words', 'mysigns', 'accuracy'] },
  settings: { tip: 'Appearance has animated seasonal themes, and you can pick your own colour.', suggest: ['themes', 'offline', 'mascot'] },
  recorded: { tip: 'Choose a video of someone signing to get subtitles.', suggest: ['recorded', 'accuracy'] },
};

export const topicById = (id) => TOPICS.find((t) => t.id === id);

/** Best local answer for a free-text question, or null. */
export function answer(question) {
  const q = ` ${String(question || '').toLowerCase()} `;
  let best = null;
  let bestScore = 0;
  for (const t of TOPICS) {
    const score = t.keys.reduce((n, k) => n + (q.includes(k) ? k.length : 0), 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  if (best) return best;
  const talk = SMALL_TALK.find((s) => s.keys.some((k) => q.includes(k)));
  return talk ? { id: 'talk', answer: talk.answer, actions: [] } : null;
}
