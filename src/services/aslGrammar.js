/**
 * Offline ASL gloss -> English. Deterministic rules, no network, no model.
 *
 * Covers the patterns the ASL tagger's 250 signs can actually produce:
 *   single-sign utterances  HELLO, THANK_YOU, YES, NO, PLEASE, BYE
 *   states                  YOU HUNGRY / DOG CUTE      -> "You are hungry." / "The dog is cute."
 *   actions + time          YESTERDAY STORE GO         -> "I went to the store yesterday."
 *   negation (NOT last)     PIZZA LIKE NOT             -> "I do not like pizza."
 *   WH-questions (WH last)  MOM WHERE / WHO ... / WHY ...
 *   possessive MY           MY DOG SICK                -> "My dog is sick."
 *   fingerspelled names     FS-PRIYA                   -> "Priya" (never translated)
 *
 * Yes/no questions are marked in ASL by the eyebrows, which the tagger cannot
 * see, so a statement is never turned into a question here. Anything the
 * rules cannot place is kept as a plain word list rather than guessed at.
 */

const UTTERANCES = {
  HELLO: 'Hello.', THANK_YOU: 'Thank you.', THANKYOU: 'Thank you.', PLEASE: 'Please.',
  YES: 'Yes.', NO: 'No.', BYE: 'Goodbye.', SHH: 'Shh, quiet please.', FINE: 'I am fine.',
};

const PRONOUNS = {
  I: { s: 'I', be: 'am', p: 1 }, ME: { s: 'I', be: 'am', p: 1 },
  YOU: { s: 'you', be: 'are', p: 2 }, YOURSELF: { s: 'you', be: 'are', p: 2 },
  HE_SHE_IT: { s: 'he', be: 'is', p: 3 }, HE: { s: 'he', be: 'is', p: 3 }, SHE: { s: 'she', be: 'is', p: 3 },
  WE: { s: 'we', be: 'are', p: 1, plural: true }, THEY: { s: 'they', be: 'are', p: 3, plural: true },
};

const PEOPLE = new Set([
  'MOM', 'DAD', 'BROTHER', 'SISTER', 'GRANDMA', 'GRANDPA', 'AUNT', 'UNCLE', 'BOY',
  'GIRL', 'CHILD', 'MAN', 'PERSON', 'FIREMAN', 'COWBOY', 'CLOWN', 'POLICE', 'FRIEND', 'DOCTOR',
]);
const FAMILY = new Set(['MOM', 'DAD', 'GRANDMA', 'GRANDPA']);   // used like names: no article

const TIME = {
  YESTERDAY: { tense: 'past', text: 'yesterday' }, TOMORROW: { tense: 'future', text: 'tomorrow' },
  NOW: { tense: 'present', text: 'now' }, LATER: { tense: 'future', text: 'later' },
  BEFORE: { tense: 'past', text: 'before' }, MORNING: { tense: 'present', text: 'in the morning' },
  NIGHT: { tense: 'present', text: 'at night' },
};

const WH = { WHERE: 'where', WHO: 'who', WHY: 'why', WHAT: 'what', HOW: 'how', WHEN: 'when' };
const NEGATION = new Set(['NOT', 'NEVER']);

const ADJECTIVES = new Set([
  'HUNGRY', 'THIRSTY', 'SICK', 'HAPPY', 'SAD', 'MAD', 'SLEEPY', 'AWAKE', 'HOT', 'FINE', 'BAD',
  'BETTER', 'CUTE', 'DIRTY', 'CLEAN', 'WET', 'DRY', 'LOUD', 'QUIET', 'OLD', 'FAST', 'EMPTY',
  'STICKY', 'YUCKY', 'PRETTY', 'NOISY', 'STUCK', 'SAME', 'HIGH', 'RED', 'BLUE', 'GREEN', 'YELLOW',
  'WHITE', 'BLACK', 'BROWN', 'ORANGE', 'HURT_OWIE', 'HURT',
]);

// base, past, 3rd-person present, preposition before an object place
const VERBS = {
  GO: ['go', 'went', 'goes', 'to'], COME: ['come', 'came', 'comes', 'to'], DRINK: ['drink', 'drank', 'drinks'],
  EAT: ['eat', 'ate', 'eats'], LIKE: ['like', 'liked', 'likes'], HATE: ['hate', 'hated', 'hates'],
  WANT: ['want', 'wanted', 'wants'], HAVE: ['have', 'had', 'has'], HAVE_TO: ['have to', 'had to', 'has to'],
  GIVE: ['give', 'gave', 'gives'], FIND: ['find', 'found', 'finds'], SEE: ['see', 'saw', 'sees'],
  LOOK: ['look at', 'looked at', 'looks at'], HEAR: ['hear', 'heard', 'hears'],
  LISTEN: ['listen to', 'listened to', 'listens to'], READ: ['read', 'read', 'reads'],
  SLEEP: ['sleep', 'slept', 'sleeps'], NAP: ['nap', 'napped', 'naps'], WAIT: ['wait', 'waited', 'waits', 'for'],
  STAY: ['stay', 'stayed', 'stays', 'at'], RIDE: ['ride', 'rode', 'rides'], DANCE: ['dance', 'danced', 'dances'],
  JUMP: ['jump', 'jumped', 'jumps'], CRY: ['cry', 'cried', 'cries'], SMILE: ['smile', 'smiled', 'smiles'],
  TALK: ['talk', 'talked', 'talks', 'to'], SAY: ['say', 'said', 'says'], THINK: ['think', 'thought', 'thinks'],
  MAKE: ['make', 'made', 'makes'], CUT: ['cut', 'cut', 'cuts'], TOUCH: ['touch', 'touched', 'touches'],
  CLOSE: ['close', 'closed', 'closes'], OPEN: ['open', 'opened', 'opens'], FINISH: ['finish', 'finished', 'finishes'],
  DROP: ['drop', 'dropped', 'drops'], FALL: ['fall', 'fell', 'falls'], HIDE: ['hide', 'hid', 'hides'],
  KISS: ['kiss', 'kissed', 'kisses'], TASTE: ['taste', 'tasted', 'tastes'], WAKE: ['wake up', 'woke up', 'wakes up'],
  CALL_ON_PHONE: ['call', 'called', 'calls'], PRETEND: ['pretend', 'pretended', 'pretends'],
  BLOW: ['blow', 'blew', 'blows'], LOVE: ['love', 'loved', 'loves'], HELP: ['help', 'helped', 'helps'],
};

/** Nouns used without an article. */
const NO_ARTICLE = new Set([
  'HOME', 'WATER', 'MILK', 'FOOD', 'CEREAL', 'GUM', 'ICE_CREAM', 'CHOCOLATE', 'PIZZA', 'SNOW', 'RAIN',
  'GRASS', 'TV', 'FRENCH_FRIES', 'NUTS', 'SCHOOL', 'BED', 'TIME',
]);

const words = (t) => t.toLowerCase().replace(/_/g, ' ');

function capital(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function parse(raw) {
  const t = String(raw || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (/^FS[-_]/.test(t)) return { kind: 'name', text: capital(t.slice(3).toLowerCase()) };
  if (UTTERANCES[t]) return { kind: 'utterance', key: t };
  if (PRONOUNS[t]) return { kind: 'pronoun', key: t, ...PRONOUNS[t] };
  if (t === 'MY' || t === 'MINE' || t === 'MINE_MY') return { kind: 'my' };
  if (TIME[t]) return { kind: 'time', ...TIME[t] };
  if (WH[t]) return { kind: 'wh', text: WH[t] };
  if (NEGATION.has(t)) return { kind: 'not' };
  if (VERBS[t]) return { kind: 'verb', key: t, forms: VERBS[t] };
  if (ADJECTIVES.has(t)) return { kind: 'adj', text: t === 'HURT_OWIE' ? 'hurt' : words(t) };
  if (PEOPLE.has(t)) return { kind: 'person', key: t };
  return { kind: 'noun', key: t };
}

/** Noun phrase for a person / thing, honouring a preceding MY. */
function np(item, my) {
  if (item.kind === 'name') return item.text;
  const w = words(item.key);
  if (my) return `my ${w}`;
  if (FAMILY.has(item.key)) return w;
  if (NO_ARTICLE.has(item.key)) return w;
  return `the ${w}`;
}

function conj(verb, tense, subj) {
  const [base, past, third] = verb.forms;
  if (tense === 'past') return past;
  if (tense === 'future') return `will ${base}`;
  return subj.p === 3 && !subj.plural ? third : base;
}

function negate(verb, tense, subj) {
  const [base] = verb.forms;
  if (tense === 'past') return `did not ${base}`;
  if (tense === 'future') return `will not ${base}`;
  return `${subj.p === 3 && !subj.plural ? 'does' : 'do'} not ${base}`;
}

function be(subj, tense) {
  if (tense === 'past') return subj.plural || subj.p === 2 ? 'were' : 'was';
  if (tense === 'future') return 'will be';
  return subj.be;
}

function sentence(parts, question = false) {
  const s = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return s ? capital(s) + (question ? '?' : '.') : '';
}

/**
 * @param {string[]} tags ASL gloss tokens in signed order
 * @returns {{english: string, rule: string}}
 */
export function expandAsl(tags) {
  const items = (tags || []).map(parse);
  if (!items.length) return { english: '', rule: 'empty' };
  if (items.length === 1 && items[0].kind === 'utterance') {
    return { english: UTTERANCES[items[0].key], rule: 'utterance' };
  }
  // A leading greeting/thanks is its own clause: "HELLO MY NAME FS-X".
  if (items[0].kind === 'utterance' && items.length > 1) {
    const rest = expandAsl(tags.slice(1));
    // Lower-case the second clause's first letter, except the pronoun "I".
    const tail = /^I\b/.test(rest.english)
      ? rest.english
      : rest.english.charAt(0).toLowerCase() + rest.english.slice(1);
    return { english: `${UTTERANCES[items[0].key].replace(/\.$/, ',')} ${tail}`, rule: `utterance+${rest.rule}` };
  }

  // MY NAME FS-X: the introduction, with the name kept exactly.
  const nameAt = items.findIndex((it) => it.kind === 'name');
  if (nameAt >= 0 && items.some((it) => it.kind === 'noun' && it.key === 'NAME')) {
    return { english: `My name is ${items[nameAt].text}.`, rule: 'introduction' };
  }

  const time = items.find((it) => it.kind === 'time');
  const tense = time?.tense || 'present';
  const wh = items.find((it) => it.kind === 'wh');
  const not = items.some((it) => it.kind === 'not');
  const verb = items.find((it) => it.kind === 'verb');
  const adj = items.find((it) => it.kind === 'adj');

  // Subject: pronoun > name/person (possibly MY X) > dropped ("I").
  let subj = null;
  let subjIndex = -1;
  items.forEach((it, i) => {
    if (subj) return;
    if (it.kind === 'pronoun') { subj = { s: it.s, be: it.be, p: it.p, plural: it.plural }; subjIndex = i; }
  });
  const nounLike = items
    .map((it, i) => ({ it, i, my: items[i - 1]?.kind === 'my' }))
    .filter(({ it }) => it.kind === 'noun' || it.kind === 'person' || it.kind === 'name');
  if (!subj) {
    // A person, a name, or (for a state with no verb) any thing is the subject.
    const cand = nounLike.find(({ it }) => it.kind !== 'noun') || (adj && !verb ? nounLike[0] : null);
    if (cand) {
      subj = { s: np(cand.it, cand.my), be: 'is', p: 3 };
      subjIndex = cand.i;
    }
  }
  const dropped = !subj;
  if (!subj) subj = { s: 'I', be: 'am', p: 1 };
  const objects = nounLike.filter(({ i }) => i !== subjIndex).map(({ it, my }) => np(it, my));

  // WH-questions.
  if (wh) {
    if (wh.text === 'where' && !verb) {
      const what = dropped && objects.length ? objects[0] : subj.s;
      const cop = dropped && objects.length ? 'is' : be(subj, tense);
      return { english: sentence(['where', cop, what], true), rule: 'wh-where' };
    }
    if (wh.text === 'who' && verb) {
      return { english: sentence(['who', conj(verb, tense, { p: 3 }), ...objects], true), rule: 'wh-who' };
    }
    if (adj && !verb) {
      return { english: sentence([wh.text, be(subj, tense), subj.s, not ? 'not' : '', adj.text], true), rule: 'wh-state' };
    }
    if (verb) {
      const aux = tense === 'past' ? 'did' : tense === 'future' ? 'will' : subj.p === 3 && !subj.plural ? 'does' : 'do';
      const prep = verb.forms[3] && objects.length ? verb.forms[3] : '';
      return { english: sentence([wh.text, aux, subj.s, not ? 'not' : '', verb.forms[0], prep, ...objects], true), rule: 'wh-action' };
    }
    return { english: sentence([wh.text, 'is', objects[0] || subj.s], true), rule: 'wh-bare' };
  }

  // State: "<subject> <be> [not] <adjective>".
  if (adj && !verb) {
    return {
      english: sentence([subj.s, be(subj, tense), not ? 'not' : '', adj.text, time && tense !== 'present' ? time.text : '']),
      rule: 'state',
    };
  }

  // Action: "<subject> <verb> <objects> <time>".
  if (verb) {
    const v = not ? negate(verb, tense, subj) : conj(verb, tense, subj);
    const prep = verb.forms[3] && objects.length && !NO_ARTICLE.has(nounLike.find(({ i }) => i !== subjIndex)?.it.key)
      ? verb.forms[3] : '';
    return {
      english: sentence([subj.s, v, prep, ...objects, time ? time.text : '']),
      rule: `action-${tense}`,
    };
  }

  // Nothing to build a clause from: say the signs, honestly, as a list.
  return {
    english: sentence(items.map((it) => (it.kind === 'name' ? it.text : it.kind === 'my' ? 'my' : words(it.key || it.text || '')))),
    rule: 'word-list',
  };
}

export default { expandAsl };
