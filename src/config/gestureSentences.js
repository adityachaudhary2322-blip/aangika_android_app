/**
 * Full sentences for each of the 20 daily-life signs, in all 11 languages.
 *
 * These are fixed templates, not translation. The offline path has no
 * translation model, so a token only reaches another language if it appears
 * here. That is why the table is exhaustive rather than generated.
 *
 * A single sign carries a whole utterance in ISL — WATER at the mouth means
 * "I need water", not the bare noun — so the templates expand accordingly
 * rather than emitting a dictionary gloss.
 */

export const GESTURE_SENTENCES = {
  HELLO: {
    'en-IN': 'Hello.', 'hi-IN': 'नमस्ते।', 'ta-IN': 'வணக்கம்.', 'te-IN': 'నమస్కారం.',
    'bn-IN': 'নমস্কার।', 'mr-IN': 'नमस्कार.', 'gu-IN': 'નમસ્તે.', 'kn-IN': 'ನಮಸ್ಕಾರ.',
    'ml-IN': 'നമസ്കാരം.', 'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ।', 'od-IN': 'ନମସ୍କାର।',
  },
  STOP: {
    'en-IN': 'Stop.', 'hi-IN': 'रुकिए।', 'ta-IN': 'நிறுத்துங்கள்.', 'te-IN': 'ఆగండి.',
    'bn-IN': 'থামুন।', 'mr-IN': 'थांबा.', 'gu-IN': 'રોકાઓ.', 'kn-IN': 'ನಿಲ್ಲಿಸಿ.',
    'ml-IN': 'നിർത്തുക.', 'pa-IN': 'ਰੁਕੋ।', 'od-IN': 'ଅଟକନ୍ତୁ।',
  },
  GOOD: {
    'en-IN': 'That is good.', 'hi-IN': 'यह अच्छा है।', 'ta-IN': 'இது நல்லது.',
    'te-IN': 'ఇది మంచిది.', 'bn-IN': 'এটা ভালো।', 'mr-IN': 'हे चांगले आहे.',
    'gu-IN': 'આ સારું છે.', 'kn-IN': 'ಇದು ಒಳ್ಳೆಯದು.', 'ml-IN': 'ഇത് നല്ലതാണ്.',
    'pa-IN': 'ਇਹ ਚੰਗਾ ਹੈ।', 'od-IN': 'ଏହା ଭଲ।',
  },
  BAD: {
    'en-IN': 'That is bad.', 'hi-IN': 'यह बुरा है।', 'ta-IN': 'இது மோசம்.',
    'te-IN': 'ఇది చెడ్డది.', 'bn-IN': 'এটা খারাপ।', 'mr-IN': 'हे वाईट आहे.',
    'gu-IN': 'આ ખરાબ છે.', 'kn-IN': 'ಇದು ಕೆಟ್ಟದು.', 'ml-IN': 'ഇത് മോശമാണ്.',
    'pa-IN': 'ਇਹ ਮਾੜਾ ਹੈ।', 'od-IN': 'ଏହା ଖରାପ।',
  },
  YES: {
    'en-IN': 'Yes.', 'hi-IN': 'हाँ।', 'ta-IN': 'ஆம்.', 'te-IN': 'అవును.',
    'bn-IN': 'হ্যাঁ।', 'mr-IN': 'होय.', 'gu-IN': 'હા.', 'kn-IN': 'ಹೌದು.',
    'ml-IN': 'അതെ.', 'pa-IN': 'ਹਾਂ।', 'od-IN': 'ହଁ।',
  },
  NO: {
    'en-IN': 'No.', 'hi-IN': 'नहीं।', 'ta-IN': 'இல்லை.', 'te-IN': 'కాదు.',
    'bn-IN': 'না।', 'mr-IN': 'नाही.', 'gu-IN': 'ના.', 'kn-IN': 'ಇಲ್ಲ.',
    'ml-IN': 'ഇല്ല.', 'pa-IN': 'ਨਹੀਂ।', 'od-IN': 'ନା।',
  },
  WATER: {
    'en-IN': 'I need water.', 'hi-IN': 'मुझे पानी चाहिए।', 'ta-IN': 'எனக்கு தண்ணீர் வேண்டும்.',
    'te-IN': 'నాకు నీళ్ళు కావాలి.', 'bn-IN': 'আমার জল দরকার।', 'mr-IN': 'मला पाणी हवे आहे.',
    'gu-IN': 'મને પાણી જોઈએ છે.', 'kn-IN': 'ನನಗೆ ನೀರು ಬೇಕು.', 'ml-IN': 'എനിക്ക് വെള്ളം വേണം.',
    'pa-IN': 'ਮੈਨੂੰ ਪਾਣੀ ਚਾਹੀਦਾ ਹੈ।', 'od-IN': 'ମୋତେ ପାଣି ଦରକାର।',
  },
  FOOD: {
    'en-IN': 'I need food.', 'hi-IN': 'मुझे खाना चाहिए।', 'ta-IN': 'எனக்கு உணவு வேண்டும்.',
    'te-IN': 'నాకు ఆహారం కావాలి.', 'bn-IN': 'আমার খাবার দরকার।', 'mr-IN': 'मला अन्न हवे आहे.',
    'gu-IN': 'મને ખોરાક જોઈએ છે.', 'kn-IN': 'ನನಗೆ ಆಹಾರ ಬೇಕು.', 'ml-IN': 'എനിക്ക് ഭക്ഷണം വേണം.',
    'pa-IN': 'ਮੈਨੂੰ ਖਾਣਾ ਚਾਹੀਦਾ ਹੈ।', 'od-IN': 'ମୋତେ ଖାଦ୍ୟ ଦରକାର।',
  },
  PLEASE: {
    'en-IN': 'Please.', 'hi-IN': 'कृपया।', 'ta-IN': 'தயவுசெய்து.', 'te-IN': 'దయచేసి.',
    'bn-IN': 'অনুগ্রহ করে।', 'mr-IN': 'कृपया.', 'gu-IN': 'કૃપા કરીને.', 'kn-IN': 'ದಯವಿಟ್ಟು.',
    'ml-IN': 'ദയവായി.', 'pa-IN': 'ਕਿਰਪਾ ਕਰਕੇ।', 'od-IN': 'ଦୟାକରି।',
  },
  THANK_YOU: {
    'en-IN': 'Thank you.', 'hi-IN': 'धन्यवाद।', 'ta-IN': 'நன்றி.', 'te-IN': 'ధన్యవాదాలు.',
    'bn-IN': 'ধন্যবাদ।', 'mr-IN': 'धन्यवाद.', 'gu-IN': 'આભાર.', 'kn-IN': 'ಧನ್ಯವಾದ.',
    'ml-IN': 'നന്ദി.', 'pa-IN': 'ਧੰਨਵਾਦ।', 'od-IN': 'ଧନ୍ୟବାଦ।',
  },
  HELP: {
    'en-IN': 'I need help.', 'hi-IN': 'मुझे मदद चाहिए।', 'ta-IN': 'எனக்கு உதவி வேண்டும்.',
    'te-IN': 'నాకు సహాయం కావాలి.', 'bn-IN': 'আমার সাহায্য দরকার।', 'mr-IN': 'मला मदत हवी आहे.',
    'gu-IN': 'મને મદદ જોઈએ છે.', 'kn-IN': 'ನನಗೆ ಸಹಾಯ ಬೇಕು.', 'ml-IN': 'എനിക്ക് സഹായം വേണം.',
    'pa-IN': 'ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ।', 'od-IN': 'ମୋତେ ସାହାଯ୍ୟ ଦରକାର।',
  },
  WASHROOM: {
    'en-IN': 'Where is the washroom?', 'hi-IN': 'शौचालय कहाँ है?', 'ta-IN': 'கழிப்பறை எங்கே?',
    'te-IN': 'మరుగుదొడ్డి ఎక్కడ ఉంది?', 'bn-IN': 'শৌচাগার কোথায়?', 'mr-IN': 'स्वच्छतागृह कुठे आहे?',
    'gu-IN': 'શૌચાલય ક્યાં છે?', 'kn-IN': 'ಶೌಚಾಲಯ ಎಲ್ಲಿದೆ?', 'ml-IN': 'ശൗചാലയം എവിടെയാണ്?',
    'pa-IN': 'ਪਖਾਨਾ ਕਿੱਥੇ ਹੈ?', 'od-IN': 'ଶୌଚାଳୟ କେଉଁଠି?',
  },
  SORRY: {
    'en-IN': 'I am sorry.', 'hi-IN': 'मुझे माफ़ कीजिए।', 'ta-IN': 'மன்னிக்கவும்.',
    'te-IN': 'క్షమించండి.', 'bn-IN': 'আমি দুঃখিত।', 'mr-IN': 'मला माफ करा.',
    'gu-IN': 'મને માફ કરો.', 'kn-IN': 'ಕ್ಷಮಿಸಿ.', 'ml-IN': 'ക്ഷമിക്കണം.',
    'pa-IN': 'ਮੈਨੂੰ ਮਾਫ਼ ਕਰੋ।', 'od-IN': 'ମୋତେ କ୍ଷମା କରନ୍ତୁ।',
  },
  UNDERSTAND: {
    'en-IN': 'I understand.', 'hi-IN': 'मैं समझ गया।', 'ta-IN': 'எனக்குப் புரிகிறது.',
    'te-IN': 'నాకు అర్థమైంది.', 'bn-IN': 'আমি বুঝেছি।', 'mr-IN': 'मला समजले.',
    'gu-IN': 'મને સમજાયું.', 'kn-IN': 'ನನಗೆ ಅರ್ಥವಾಯಿತು.', 'ml-IN': 'എനിക്ക് മനസ്സിലായി.',
    'pa-IN': 'ਮੈਂ ਸਮਝ ਗਿਆ।', 'od-IN': 'ମୁଁ ବୁଝିଲି।',
  },
  DONT_UNDERSTAND: {
    'en-IN': 'I do not understand.', 'hi-IN': 'मैं नहीं समझा।', 'ta-IN': 'எனக்குப் புரியவில்லை.',
    'te-IN': 'నాకు అర్థం కాలేదు.', 'bn-IN': 'আমি বুঝিনি।', 'mr-IN': 'मला समजले नाही.',
    'gu-IN': 'મને સમજાયું નથી.', 'kn-IN': 'ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ.', 'ml-IN': 'എനിക്ക് മനസ്സിലായില്ല.',
    'pa-IN': 'ਮੈਨੂੰ ਸਮਝ ਨਹੀਂ ਆਇਆ।', 'od-IN': 'ମୁଁ ବୁଝି ପାରିଲି ନାହିଁ।',
  },
  DOCTOR: {
    'en-IN': 'I need a doctor.', 'hi-IN': 'मुझे डॉक्टर चाहिए।', 'ta-IN': 'எனக்கு மருத்துவர் வேண்டும்.',
    'te-IN': 'నాకు వైద్యుడు కావాలి.', 'bn-IN': 'আমার ডাক্তার দরকার।', 'mr-IN': 'मला डॉक्टर हवे आहेत.',
    'gu-IN': 'મને ડૉક્ટર જોઈએ છે.', 'kn-IN': 'ನನಗೆ ವೈದ್ಯರು ಬೇಕು.', 'ml-IN': 'എനിക്ക് ഡോക്ടറെ വേണം.',
    'pa-IN': 'ਮੈਨੂੰ ਡਾਕਟਰ ਚਾਹੀਦਾ ਹੈ।', 'od-IN': 'ମୋତେ ଡାକ୍ତର ଦରକାର।',
  },
  POLICE: {
    'en-IN': 'I need the police.', 'hi-IN': 'मुझे पुलिस चाहिए।', 'ta-IN': 'எனக்கு காவல்துறை வேண்டும்.',
    'te-IN': 'నాకు పోలీసు కావాలి.', 'bn-IN': 'আমার পুলিশ দরকার।', 'mr-IN': 'मला पोलीस हवे आहेत.',
    'gu-IN': 'મને પોલીસ જોઈએ છે.', 'kn-IN': 'ನನಗೆ ಪೊಲೀಸ್ ಬೇಕು.', 'ml-IN': 'എനിക്ക് പോലീസിനെ വേണം.',
    'pa-IN': 'ਮੈਨੂੰ ਪੁਲਿਸ ਚਾਹੀਦੀ ਹੈ।', 'od-IN': 'ମୋତେ ପୋଲିସ ଦରକାର।',
  },
  HOW_MUCH: {
    'en-IN': 'How much does this cost?', 'hi-IN': 'यह कितने का है?', 'ta-IN': 'இது என்ன விலை?',
    'te-IN': 'ఇది ఎంత?', 'bn-IN': 'এটার দাম কত?', 'mr-IN': 'याची किंमत किती आहे?',
    'gu-IN': 'આની કિંમત કેટલી છે?', 'kn-IN': 'ಇದರ ಬೆಲೆ ಎಷ್ಟು?', 'ml-IN': 'ഇതിന് എത്ര വിലയാണ്?',
    'pa-IN': 'ਇਸ ਦੀ ਕੀਮਤ ਕਿੰਨੀ ਹੈ?', 'od-IN': 'ଏହାର ଦାମ କେତେ?',
  },
  NAME_ADITYA: {
    'en-IN': 'Hello, my name is Aditya.', 'hi-IN': 'नमस्ते, मेरा नाम आदित्य है।',
    'ta-IN': 'வணக்கம், என் பெயர் ஆதித்யா.', 'te-IN': 'నమస్కారం, నా పేరు ఆదిత్య.',
    'bn-IN': 'নমস্কার, আমার নাম আদিত্য।', 'mr-IN': 'नमस्कार, माझे नाव आदित्य आहे.',
    'gu-IN': 'નમસ્તે, મારું નામ આદિત્ય છે.', 'kn-IN': 'ನಮಸ್ಕಾರ, ನನ್ನ ಹೆಸರು ಆದಿತ್ಯ.',
    'ml-IN': 'നമസ്കാരം, എന്റെ പേര് ആദിത്യ.', 'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੇਰਾ ਨਾਮ ਆਦਿਤਿਆ ਹੈ।',
    'od-IN': 'ନମସ୍କାର, ମୋର ନାମ ଆଦିତ୍ୟ।',
  },
  GOODBYE: {
    'en-IN': 'Goodbye.', 'hi-IN': 'अलविदा।', 'ta-IN': 'போய் வருகிறேன்.', 'te-IN': 'వెళ్ళొస్తాను.',
    'bn-IN': 'বিদায়।', 'mr-IN': 'निरोप.', 'gu-IN': 'આવજો.', 'kn-IN': 'ಹೋಗಿ ಬರುತ್ತೇನೆ.',
    'ml-IN': 'വിട.', 'pa-IN': 'ਅਲਵਿਦਾ।', 'od-IN': 'ବିଦାୟ।',
  },
};

/** The 20 tokens, in the order of the classifier's decision tree. */
export const GESTURE_TOKENS = Object.keys(GESTURE_SENTENCES);

/**
 * Sentence for a token in a language.
 * Falls back to English, then to the token itself, so a caller always gets
 * something displayable rather than undefined.
 */
export function sentenceFor(token, code = 'en-IN') {
  const row = GESTURE_SENTENCES[String(token || '').toUpperCase()];
  if (!row) return null;
  return row[code] || row['en-IN'] || null;
}

export default { GESTURE_SENTENCES, GESTURE_TOKENS, sentenceFor };
