import { useEffect, useState } from 'react';
import isl from '../services/isl/islDictionary.js';

/**
 * The ISL Studio dictionary (the team's own signs), kept current: stored
 * copy first, then one check with the server. -> { signs, syncState, resync }
 */
export default function useIslSigns({ sync = true } = {}) {
  const [signs, setSigns] = useState(() => isl.listSigns());
  const [syncState, setSyncState] = useState(null);

  useEffect(() => {
    const refresh = () => setSigns(isl.listSigns());
    const off = isl.subscribe(refresh);
    let p = isl.init().then(refresh);
    if (sync) p = p.then(() => isl.sync().then(setSyncState).catch((e) => setSyncState(e.message)));
    return off;
  }, [sync]);

  const resync = () => isl.sync({ force: true }).then(setSyncState).catch((e) => setSyncState(e.message));
  return { signs, syncState, resync };
}
