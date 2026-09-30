/**
 * Deterministic ISL -> English grammar expansion. Runs entirely client-side.
 *
 * WHAT THIS IS NOT: there is no Qwen model here, and no neural network of any
 * kind. Qwen2.5-0.5B measured ~2.1 GB resident in the Python reference, which
 * is not something to load into a phone browser tab. What this module does is
 * execute the *rules* that were distilled while prompt-engineering that model
 * (see qwenRules.js) as ordinary code.
 *
 * WHY THAT IS AN UPGRADE, NOT A COMPROMISE: on the seven held-out cases
 * measured against the real Qwen2.5-0.5B, that model scored 1/7 -- it produced
 * "I will go to the market yesterday." even with the rule, the prohibition and
 * a near-identical worked example all in its prompt. Subject selection and
 * tense are lookup problems. Code does them perfectly and in ~0 ms; a 0.5 B
 * model does them unreliably and in ~1.4 s.
 *
 * The transformations, in the order they are applied:
 *
 *   1. exact few-shot match          the five demonstrated phrases
 *   2. question forms                WHAT / WHERE / WHO / WHEN / WHY / HOW
 *   3. possessive-help idiom         [PERSON] HELP NEED -> I need X's help
 *   4. copula insertion              HE TEACHER      -> He is a teacher
 *   5. general SOV -> SVO            SUBJ OBJ VERB   -> subj verb obj
 *
 * Every path then runs through subject recovery (pro-drop), tense from the
 * time word, article insertion and capitalisation.
 */

import { ISL_FEW_SHOT } from './qwenRules.js';
import { KNOWN_NAMES, buildIntroduction } from '../config/greetings.js';
import { sentenceFor } from '../config/gestureSentences.js';
import { findByToken } from './customSigns.js';
import { overrideFor } from './builtinOverrides.js';

// ── Lexicon ──────────────────────────────────────────────────────────────────

const SUBJECT_PRONOUNS = {
  I: { subject: 'I', possessive: 'my', person: 1 },
  ME: { subject: 'I', possessive: 'my', person: 1 },
  MY: { subject: 'I', possessive: 'my', person: 1 },
  WE: { subject: 'we', possessive: 'our', person: 1, plural: true },
  YOU: { subject: 'you', possessive: 'your', person: 2 },
  HE: { subject: 'he', possessive: 'his', person: 3 },
  SHE: { subject: 'she', possessive: 'her', person: 3 },
  THEY: { subject: 'they', possessive: 'their', person: 3, plural: true },
  IT: { subject: 'it', possessive: 'its', person: 3 },
};

/** Kinship nouns are subjects when present, and read possessively. */
const KINSHIP = new Set([
  'MOTHER', 'FATHER', 'BROTHER', 'SISTER', 'FRIEND', 'SON', 'DAUGHTER',
  'WIFE', 'HUSBAND', 'PARENT', 'FAMILY', 'UNCLE', 'AUNT', 'GRANDMOTHER',
  'GRANDFATHER', 'CHILD', 'BABY',
]);

/** Role nouns name a person but are not "mine" -- they take an article. */
const PERSON_ROLE = new Set([
  'DOCTOR', 'TEACHER', 'POLICE', 'NURSE', 'DRIVER', 'STUDENT', 'MANAGER',
  'OFFICER', 'LAWYER', 'ENGINEER', 'NEIGHBOUR', 'NEIGHBOR', 'BOSS', 'GUARD',
]);

const TIME_WORDS = {
  YESTERDAY: { tense: 'past', phrase: 'yesterday' },
  TOMORROW: { tense: 'future', phrase: 'tomorrow' },
  TODAY: { tense: 'present', phrase: 'today' },
  NOW: { tense: 'present', phrase: 'now' },
  LATER: { tense: 'future', phrase: 'later' },
  MORNING: { tense: 'present', phrase: 'in the morning' },
  EVENING: { tense: 'present', phrase: 'in the evening' },
  NIGHT: { tense: 'present', phrase: 'at night' },
  BEFORE: { tense: 'past', phrase: 'before' },
  AFTER: { tense: 'future', phrase: 'afterwards' },
};

/**
 * Verbs, with irregular past forms and the preposition each takes.
 * `object: 'to'` means the verb needs "to" before a place ("go to school").
 */
const VERBS = {
  GO: { base: 'go', past: 'went', gerund: 'going', prep: 'to' },
  COME: { base: 'come', past: 'came', gerund: 'coming', prep: 'to' },
  WANT: { base: 'want', past: 'wanted', gerund: 'wanting' },
  NEED: { base: 'need', past: 'needed', gerund: 'needing' },
  EAT: { base: 'eat', past: 'ate', gerund: 'eating' },
  DRINK: { base: 'drink', past: 'drank', gerund: 'drinking' },
  SEE: { base: 'see', past: 'saw', gerund: 'seeing' },
  GIVE: { base: 'give', past: 'gave', gerund: 'giving' },
  TAKE: { base: 'take', past: 'took', gerund: 'taking' },
  WORK: { base: 'work', past: 'worked', gerund: 'working' },
  READ: { base: 'read', past: 'read', gerund: 'reading' },
  WRITE: { base: 'write', past: 'wrote', gerund: 'writing' },
  SLEEP: { base: 'sleep', past: 'slept', gerund: 'sleeping' },
  LIVE: { base: 'live', past: 'lived', gerund: 'living', prep: 'in' },
  LIKE: { base: 'like', past: 'liked', gerund: 'liking' },
  KNOW: { base: 'know', past: 'knew', gerund: 'knowing' },
  UNDERSTAND: { base: 'understand', past: 'understood', gerund: 'understanding' },
  CALL: { base: 'call', past: 'called', gerund: 'calling' },
  MEET: { base: 'meet', past: 'met', gerund: 'meeting' },
  BUY: { base: 'buy', past: 'bought', gerund: 'buying' },
  HELP: { base: 'help', past: 'helped', gerund: 'helping' },
  SAY: { base: 'say', past: 'said', gerund: 'saying' },
  ASK: { base: 'ask', past: 'asked', gerund: 'asking' },
  LEARN: { base: 'learn', past: 'learned', gerund: 'learning' },
  PLAY: { base: 'play', past: 'played', gerund: 'playing' },
  STOP: { base: 'stop', past: 'stopped', gerund: 'stopping' },
  WAIT: { base: 'wait', past: 'waited', gerund: 'waiting', prep: 'for' },
  SIT: { base: 'sit', past: 'sat', gerund: 'sitting' },
  OPEN: { base: 'open', past: 'opened', gerund: 'opening' },
};

/**
 * Greeting signs. Not emitted by the tagger -- see custom_signs in vocab.json --
 * but reachable through manual entry and demo flows, and cheap to support.
 */
const GREETING_TOKENS = new Set(['NAMASTE', 'HELLO', 'HI', 'GREETINGS']);

/** NAME + a known name token is a self-introduction, not a generic phrase. */
const NAME_TOKENS = new Set(['NAME', 'CALLED']);

const QUESTIONS = {
  WHAT: 'what', WHERE: 'where', WHO: 'who',
  WHEN: 'when', WHY: 'why', HOW: 'how',
};

const NEGATIONS = new Set(['NOT', 'NO', 'DONT', "DON'T", 'NEVER']);

/** Places take "the"; mass nouns take nothing. */
const DEFINITE_PLACES = new Set([
  'MARKET', 'SHOP', 'HOSPITAL', 'BANK', 'STATION', 'AIRPORT', 'OFFICE',
  'TEMPLE', 'PARK', 'LIBRARY', 'POLICE',
]);
const NO_ARTICLE = new Set([
  'SCHOOL', 'COLLEGE', 'HOME', 'WORK', 'WATER', 'FOOD', 'MONEY', 'TEA',
  'COFFEE', 'MILK', 'RICE', 'HELP', 'TIME', 'BED', 'CLASS',
]);

/** Proper nouns take no article: "live in Delhi", not "live in a delhi". */
const PROPER_NOUNS = new Set([
  'DELHI', 'MUMBAI', 'KOLKATA', 'CHENNAI', 'BANGALORE', 'BENGALURU',
  'HYDERABAD', 'PUNE', 'JAIPUR', 'LUCKNOW', 'AHMEDABAD', 'INDIA',
  'AMERICA', 'ENGLAND', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY',
  'FRIDAY', 'SATURDAY', 'SUNDAY',
]);

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

// ── Helpers ──────────────────────────────────────────────────────────────────

const norm = (t) => String(t || '').trim().toUpperCase().replace(/[^A-Z']/g, '');
const lower = (t) => t.toLowerCase();

/**
 * The user's own signs, for the duration of one expand() call:
 * key -> {text, name}. A name is a proper noun shown exactly as taught; a word
 * renders as its taught text. Keys are letter-only placeholders, because
 * norm() strips the underscores and digits a taught token may contain.
 */
let customLexicon = new Map();

function article(word) {
  return VOWELS.has(word[0]) ? 'an' : 'a';
}

/** "school" -> "school"; "market" -> "the market"; "teacher" -> "a teacher". */
function nounPhrase(token, { definite = false } = {}) {
  const key = norm(token);
  const custom = customLexicon.get(key);
  if (custom) return custom.name ? custom.text : custom.text.toLowerCase();
  const word = lower(key);
  // A proper noun keeps its capital and never takes an article.
  if (PROPER_NOUNS.has(key)) return key.charAt(0) + word.slice(1);
  if (NO_ARTICLE.has(key)) return word;
  if (DEFINITE_PLACES.has(key) || definite) return `the ${word}`;
  if (KINSHIP.has(key)) return `my ${word}`;
  return `${article(word)} ${word}`;
}

function possessivePhrase(token) {
  const key = norm(token);
  const custom = customLexicon.get(key);
  if (custom?.name) return `${custom.text}'s`;
  const word = lower(key);
  if (PROPER_NOUNS.has(key)) return `${key.charAt(0) + word.slice(1)}'s`;
  if (KINSHIP.has(key)) return `my ${word}'s`;
  if (DEFINITE_PLACES.has(key)) return `the ${word}'s`;
  return `${article(word)} ${word}'s`;
}

/** Conjugate for tense and subject. */
function conjugate(verb, tense, subject) {
  if (tense === 'past') return verb.past;
  if (tense === 'future') return `will ${verb.base}`;
  const thirdSingular =
    subject && !subject.plural && subject.person === 3;
  if (!thirdSingular) return verb.base;
  // he/she/it -> verb + s, with the usual spelling cases.
  const b = verb.base;
  if (/(s|sh|ch|x|z|o)$/.test(b)) return `${b}es`;
  if (/[^aeiou]y$/.test(b)) return `${b.slice(0, -1)}ies`;
  return `${b}s`;
}

function finish(parts, { question = false } = {}) {
  const text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const capped = text.charAt(0).toUpperCase() + text.slice(1);
  if (/[.!?]$/.test(capped)) return capped;
  return capped + (question ? '?' : '.');
}

// ── Classification ───────────────────────────────────────────────────────────

function classify(tokens) {
  const out = {
    subject: null, subjectToken: null,
    time: null, timeToken: null,
    verbs: [], nouns: [], question: null, negated: false,
  };

  for (const raw of tokens) {
    const key = norm(raw);
    if (!key) continue;

    if (QUESTIONS[key]) { out.question = QUESTIONS[key]; continue; }
    if (NEGATIONS.has(key)) { out.negated = true; continue; }
    if (TIME_WORDS[key]) {
      if (!out.time) { out.time = TIME_WORDS[key]; out.timeToken = key; }
      continue;
    }
    if (SUBJECT_PRONOUNS[key]) {
      if (!out.subject) { out.subject = SUBJECT_PRONOUNS[key]; out.subjectToken = key; }
      continue;
    }
    if (VERBS[key]) { out.verbs.push({ key, ...VERBS[key] }); continue; }
    out.nouns.push(key);
  }

  // Pro-drop recovery. An explicit person noun IS the subject and must never be
  // replaced by "I" -- that was the exact failure the Android/Python work hit.
  if (!out.subject) {
    const personIndex = out.nouns.findIndex(
      (n) => KINSHIP.has(n) || PERSON_ROLE.has(n) || customLexicon.get(n)?.name
    );
    // Only promote a person noun to subject when there is something left for it
    // to act on; "DOCTOR HELP NEED" is the signer needing a doctor, not a
    // doctor needing help.
    const actsOnSomething = out.nouns.length > 1 && out.verbs.length > 0;
    const isNeedIdiom = out.verbs.some((v) => v.key === 'NEED' || v.key === 'WANT');

    if (personIndex >= 0 && actsOnSomething && !isNeedIdiom) {
      const token = out.nouns[personIndex];
      out.nouns.splice(personIndex, 1);
      out.subjectToken = token;
      const custom = customLexicon.get(token);
      out.subject = {
        subject: KINSHIP.has(token) ? `my ${lower(token)}` : nounPhrase(token),
        possessive: custom?.name ? `${custom.text}'s`
          : `${KINSHIP.has(token) ? `my ${lower(token)}` : lower(token)}'s`,
        person: 3,
      };
    } else {
      out.subject = SUBJECT_PRONOUNS.I;   // ISL drops the first person
      out.subjectToken = null;
    }
  }

  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

const FEW_SHOT_INDEX = new Map(
  ISL_FEW_SHOT.map((s) => [
    s.signs.split(',').map((t) => norm(t)).filter(Boolean).join(' '),
    s.sentence,
  ])
);

/**
 * Expand recognised sign tags into an English sentence.
 * Pure and synchronous -- no network, no model, no async.
 *
 * @param {string[]} tags
 * @returns {{ english: string, rule: string }}
 */
export function expand(tags, languageCode = 'en-IN', { lookup = findByToken } = {}) {
  customLexicon = new Map();
  const nameForms = {};
  let placeholder = 0;
  const tokens = (tags || []).map((raw) => {
    const sign = lookup(raw);
    const type = sign?.output?.type;
    if (type !== 'word' && type !== 'name') return norm(raw);
    // Letter-only placeholder: survives norm() and cannot collide with a word.
    const key = `ZQX${String.fromCharCode(65 + (placeholder++ % 26))}`;
    const text = String(sign.output.text_en || raw).trim();
    customLexicon.set(key, { text, name: type === 'name' });
    if (type === 'name') {
      nameForms[key] = { 'en-IN': text, ...(sign.output.texts || {}) };
    }
    return key;
  }).filter(Boolean);
  if (tokens.length === 0) return { english: '', rule: 'empty', translated: '' };

  // -1. A single SignBridge gesture token.
  //
  // Checked before everything else because these carry a whole utterance on
  // their own -- WATER at the mouth means "I need water", not the bare noun --
  // and because they are the only path that produces a non-English sentence
  // offline. Falling through to the SOV rules would emit "I water." instead.
  if (tags && tags.length === 1) {
    // A taught sentence sign: its stored text, in every language it has.
    const own = lookup(tags[0]);
    if (own?.output?.type === 'sentence' && own.output.text_en) {
      return {
        english: own.output.text_en,
        translated: own.output.texts?.[languageCode] || '',
        rule: 'my-sign-sentence',
      };
    }
    // Look up the RAW tag: norm() strips underscores, which would turn
    // HOW_MUCH into HOWMUCH and miss the table entirely.
    const key = String(tags[0] || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    // A developer's new meaning for a built-in sign wins (community dictionary).
    const ov = overrideFor(key);
    if (ov?.text_en) {
      return {
        english: ov.text_en,
        // The built-in templates meant the OLD meaning, so only the
        // developer's own texts are used; other languages go online.
        translated: ov.texts?.[languageCode] || '',
        rule: 'gesture-sentence-override',
      };
    }
    const english = sentenceFor(key, 'en-IN');
    if (english) {
      return {
        english,
        translated: sentenceFor(key, languageCode) || '',
        rule: 'gesture-sentence',
      };
    }
  }

  // 0. Greetings and self-introduction.
  //
  // This is the one family of phrases the offline engine can render in a
  // language other than English, because the templates are fixed (see
  // config/greetings.js). Checked first so "NAME ADITYA" never falls through to
  // the generic SOV path and comes out as "I name a aditya."
  const greetToken = tokens.find((t) => GREETING_TOKENS.has(t));
  // A taught name counts as a name here exactly like the built-in ADITYA.
  const nameToken = tokens.find((t) => KNOWN_NAMES.has(t) || nameForms[t]);
  const hasNameWord = tokens.some((t) => NAME_TOKENS.has(t));

  if (greetToken || (hasNameWord && nameToken)) {
    const introduce = Boolean(nameToken && (hasNameWord || greetToken));
    const forms = nameForms[nameToken];
    return {
      english: buildIntroduction(introduce ? nameToken : null, 'en-IN', {
        greet: Boolean(greetToken) || introduce, forms,
      }),
      translated: buildIntroduction(introduce ? nameToken : null, languageCode, {
        greet: Boolean(greetToken) || introduce, forms,
      }),
      rule: introduce ? 'greeting-introduction' : 'greeting',
    };
  }

  // 1. Exact few-shot match.
  const exact = FEW_SHOT_INDEX.get(tokens.join(' '));
  if (exact) return { english: exact, rule: 'few-shot', translated: '' };

  const c = classify(tokens);
  const tense = c.time ? c.time.tense : 'present';
  const timePhrase = c.time ? c.time.phrase : '';
  const not = c.negated;

  // 2. Question forms.
  if (c.question) {
    const noun = c.nouns[0];
    if (c.question === 'what' && noun) {
      return {
        english: finish([`what is ${c.subject.possessive} ${lower(noun)}`],
          { question: true }),
        rule: 'question-what',
      };
    }
    const verb = c.verbs[0];
    if (verb) {
      const aux = tense === 'past' ? 'did' : tense === 'future' ? 'will' : 'do';
      return {
        english: finish([
          c.question, aux, c.subject.subject, verb.base,
          noun ? nounPhrase(noun) : '', timePhrase,
        ], { question: true }),
        rule: 'question-verb',
      };
    }
    // "WHERE HOSPITAL" is asking where something IS -- the copula is dropped
    // in ISL and has to be recovered, or the output reads as a fragment.
    return {
      english: finish(
        [c.question, noun ? 'is' : '', noun ? nounPhrase(noun) : ''],
        { question: true }
      ),
      translated: '',
      rule: 'question-bare',
    };
  }

  // 3. Possessive-help idiom: [PERSON] HELP NEED -> "I need X's help."
  const hasNeed = c.verbs.some((v) => v.key === 'NEED');
  const hasHelp = c.verbs.some((v) => v.key === 'HELP');
  if (hasNeed && hasHelp) {
    const person = c.nouns.find((n) => KINSHIP.has(n) || PERSON_ROLE.has(n));
    if (person) {
      return {
        english: finish([
          c.subject.subject, conjugate(VERBS.NEED, tense, c.subject),
          not ? 'not' : '', possessivePhrase(person), 'help', timePhrase,
        ]),
        translated: '',
        rule: 'need-help-possessive',
      };
    }
  }

  // 3b. [OBJECT] [VERB] NEED -> "I need to <verb> the <object>."
  if (hasNeed && c.verbs.length > 1) {
    const action = c.verbs.find((v) => v.key !== 'NEED');
    const object = c.nouns[0];
    if (action) {
      return {
        english: finish([
          c.subject.subject, conjugate(VERBS.NEED, tense, c.subject),
          not ? 'not' : '', 'to', action.base,
          object ? nounPhrase(object, { definite: PERSON_ROLE.has(object) }) : '',
          timePhrase,
        ]),
        translated: '',
        rule: 'need-to-verb',
      };
    }
  }

  // 4. Copula: a subject and a noun with no verb at all -> "X is a Y."
  if (c.verbs.length === 0 && c.nouns.length > 0) {
    const be = tense === 'past' ? 'was'
      : tense === 'future' ? 'will be'
      : c.subject.plural || c.subject.person === 2 ? 'are'
      : c.subject.person === 1 ? 'am' : 'is';
    return {
      english: finish([
        c.subject.subject, be, not ? 'not' : '',
        nounPhrase(c.nouns[0]), timePhrase,
      ]),
      translated: '',
      rule: 'copula',
    };
  }

  // 5. General SOV -> SVO.
  const verb = c.verbs[0];
  if (!verb) {
    return {
      english: finish(tokens.map((t) => (customLexicon.has(t) ? nounPhrase(t) : lower(t)))),
      rule: 'passthrough',
      translated: '',
    };
  }

  // Present tense with a third-person subject and a concrete object reads more
  // naturally as a progressive: "My sister is reading a book."
  const useProgressive =
    tense === 'present' && c.subject.person === 3 && c.nouns.length > 0 && !c.time;

  let verbPhrase;
  if (not) {
    verbPhrase = tense === 'past' ? `did not ${verb.base}`
      : tense === 'future' ? `will not ${verb.base}`
      : `${c.subject.person === 3 && !c.subject.plural ? 'does' : 'do'} not ${verb.base}`;
  } else if (useProgressive) {
    verbPhrase = `is ${verb.gerund}`;
  } else {
    verbPhrase = conjugate(verb, tense, c.subject);
  }

  const objects = c.nouns.map((n, i) => {
    const prep = i === 0 && verb.prep ? `${verb.prep} ` : '';
    return prep + nounPhrase(n);
  });

  return {
    english: finish([c.subject.subject, verbPhrase, ...objects, timePhrase]),
    translated: '',
    rule: useProgressive ? 'svo-progressive' : `svo-${tense}`,
  };
}

export default { expand };
