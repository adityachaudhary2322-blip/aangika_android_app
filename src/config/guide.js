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

TOPICS.push({
  id: 'tour',
  title: 'Show me around',
  keys: ['tour', 'show me around', 'what can you do', 'features', 'feature', 'help me start', 'walk me', 'explain the app', 'what is this app'],
  answer: 'Happy to! I’ll run to each feature on this screen and explain what it does.',
  actions: [{ label: 'Start the tour', tour: true }],
});

TOPICS.push({
  id: 'meet',
  title: 'Start or join a meeting',
  keys: ['meeting', 'meet', 'room', 'group', 'join', 'conference', 'share id', 'my id', 'user id', 'invite'],
  answer:
    'Everyone gets their own ID automatically. In Meet you can create a room, share its code or link, and others join by typing the code. Captions of your signing go to everyone in the room.',
  actions: [{ label: 'Open Meet', go: 'meet' }],
});

TOPICS.push({
  id: 'sarvam',
  title: 'What is Sarvam?',
  keys: ['sarvam', 'grammar engine', 'ai engine', 'which engine', 'bulbul', 'mayura', 'saaras'],
  answer:
    'Sarvam is an Indian-language AI service. With a Sarvam key (Settings), it turns your signs into a proper sentence, translates it into any of 11 languages, speaks it aloud, and writes down speech in those languages too.',
  actions: [{ label: 'Open Settings', go: 'settings' }],
});

/**
 * Guided tours, per screen. `target` matches a data-tour attribute; steps
 * whose target is not on screen (hidden on this layout) are skipped.
 */
export const TOURS = {
  dashboard: [
    { target: 'hero-sign', title: 'Sign to speech', text: 'Point the camera at a signer. Each sign held for a moment is spoken aloud, and several in a row become a sentence.', go: 'sign' },
    { target: 'hero-hearing', title: 'Speech to text', text: 'For the other direction: whatever is said becomes large captions, and your typed replies are read aloud.', go: 'hearing' },
    { target: 'lang', title: 'Your language', text: 'Everything is spoken and translated into this language. There are 11 to choose from.' },
    { target: 'engine', title: 'Online or offline', text: 'Tap to switch between the AI engine (Sarvam or Gemini) and the offline grammar rules, which need no internet.' },
    { target: 'tool-phrases', title: 'Phrases', text: 'Sign a few words in a row and give them one meaning, like “Hi, I’m Asha”. The translator will say your sentence.', go: 'phrases' },
    { target: 'tool-meet', title: 'Meet', text: 'Create a meeting room, share the code, and talk in a group with sign captions for everyone.', go: 'meet' },
    { target: 'tool-mysigns', title: 'My signs', text: 'Teach a handshape for a name or a word the app does not know yet.', go: 'mysigns' },
    { target: 'tool-words', title: 'Word list', text: 'Every sign Aangika can recognise. Search it before signing something unusual.', go: 'words' },
    { target: 'theme-card', title: 'Make it yours', text: 'Switch palettes here. The seasonal ones are animated, with petals, leaves, snow or fireflies.' },
    { target: 'nav', title: 'Getting around', text: 'Home, the translator, messages and settings are always one tap away here. And I’m always in the corner if you need me!' },
  ],
  hearing: [
    { target: 'their-lang', title: 'Their language', text: 'Pick what the other person speaks, or let it auto-detect. Turn on “Also show in …” to see each line in your language too.' },
    { target: 'hearing-log', title: 'The conversation', text: 'Every line they say and every reply you give is kept here. Copy it or save it as notes.' },
    { target: 'quick-replies', title: 'Quick replies', text: 'One tap shows a big card and says it aloud. Handy at a counter or a clinic.' },
    { target: 'mic', title: 'Listen', text: 'Tap to start listening, and tap again to turn what was said into text.' },
  ],
  phrases: [
    { target: 'phrase-record', title: 'Record a phrase', text: 'Sign the words in order in front of the camera; I’ll collect them as you go.' },
    { target: 'phrase-type', title: 'Or type it', text: 'No camera handy? Type the signs by name instead, then write the meaning.' },
  ],
  meet: [
    { target: 'my-id', title: 'Your ID', text: 'This is yours alone. Share it so friends can call or message you.' },
    { target: 'meet-create', title: 'Create a room', text: 'Makes a room with its own code. Share the code or link and people join straight in.' },
    { target: 'meet-join', title: 'Join a room', text: 'Got a code from someone? Type it here to join their meeting.' },
  ],
  settings: [
    { target: 'appearance', title: 'Appearance', text: 'Light or dark, eight palettes, your own colour, and switches for the animations and for me.' },
    { target: 'grammar', title: 'Grammar engine', text: 'Choose how signs become sentences: Sarvam, Gemini, the offline rules, or the raw words.' },
    { target: 'keys', title: 'Keys', text: 'Add a Sarvam key to unlock sentences, translation and voice in all 11 languages.' },
  ],
  words: [
    { target: 'word-search', title: 'Search', text: 'Type a word to see whether the camera can recognise it. Tap any word to hear it.' },
  ],
  messenger: [
    { target: 'my-id', title: 'Your ID', text: 'Friends reach you with this. There are no accounts or passwords.' },
    { target: 'add-friend', title: 'Add a friend', text: 'Type a friend’s ID to add them, then chat or start a video call.' },
  ],
};

/** Things Mudra mentions when it wanders over with a tip. */
export const TIPS = [
  { text: 'Several signs in a row can become one sentence. Try Phrases!', go: 'phrases' },
  { text: 'Pick a seasonal theme: cherry blossom petals follow your finger.', go: 'settings' },
  { text: 'Not sure the camera knows a word? Check the Word list.', go: 'words' },
  { text: 'Create a meeting room and share its code to talk in a group.', go: 'meet' },
  { text: 'Teach me a name sign in My signs and I’ll recognise it.', go: 'mysigns' },
  { text: 'A Sarvam key unlocks voices and translation in 11 languages.', go: 'settings' },
  { text: 'Speech to text can translate what they say into your language.', go: 'hearing' },
  { text: 'Install Aangika from the browser menu to use it like an app, even offline.' },
];

/** Every topic's answer as plain facts, for grounding a Sarvam reply. */
export function guideFacts() {
  return TOPICS.map((t) => `- ${t.title}: ${t.answer}`).join('\n');
}

const SMALL_TALK = [
  { keys: ['thank', 'thanks', 'dhanyavad', 'shukriya'], answer: 'Any time! Tap me whenever you need a hand. 🙌' },
  { keys: ['hello', 'hi ', 'hey', 'namaste', 'good morning', 'good evening'], answer: 'Namaste! Ask me how anything works, or pick a question below.' },
];

/** Screen-specific opener and the questions most worth suggesting there. */
export const CONTEXT = {
  dashboard: { tip: 'Start with Sign to speech, or ask me how anything works. Want a quick tour?', suggest: ['tour', 'sign', 'phrases', 'meet'] },
  meet: { tip: 'Create a room and share its code, or type a code to join one.', suggest: ['meet', 'privacy', 'accuracy'] },
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
