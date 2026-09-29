import { useEffect, useRef } from 'react';
import SignTranslator from './SignTranslator.jsx';
import {
  getSignLanguage, getVisionEngine, setSignLanguage, setVisionEngine,
} from '../services/engineState.js';

/**
 * ASL Translator, for international users: the same translator (live or
 * record, front or back camera, grammar, speech) running the ASL model.
 *
 * Entering switches the sign language to ASL (and to the ASL default model
 * unless an ASL model is already chosen); leaving puts back whatever ISL
 * setup the user had, so the Indian translator is unchanged.
 */
export default function AslTranslator(props) {
  const { chooseVision } = props;
  const before = useRef(null);

  useEffect(() => {
    before.current = { language: getSignLanguage(), vision: getVisionEngine() };
    const { vision } = setSignLanguage('ASL');
    chooseVision(vision);
    return () => {
      const b = before.current;
      if (!b) return;
      setSignLanguage(b.language);
      chooseVision(setVisionEngine(b.vision));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <SignTranslator {...props} variant="asl" />;
}
