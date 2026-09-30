import { useEffect, useState } from 'react';
import session from '../services/session.js';

/** The signed-in account (session.js), kept current. -> user | null */
export default function useSession() {
  const [s, setS] = useState(() => session.getSession());
  useEffect(() => session.subscribe(setS), []);
  return s?.user || null;
}
