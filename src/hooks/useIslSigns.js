import { useEffect, useMemo, useState } from 'react';
import isl from '../services/isl/islDictionary.js';
import personal, { effectiveSigns } from '../services/isl/islPersonal.js';

/**
 * The ISL Studio dictionary as THIS person uses it, kept current: the team's
 * signs (stored copy first, then one check with the server) with this
 * person's own dictionary applied (islPersonal.js).
 *
 * -> { signs (what to translate with), teamSigns (the team's, for the
 *      developer tools), mine (personal data), syncState, resync }
 */
export default function useIslSigns({ sync = true } = {}) {
  const [teamSigns, setTeamSigns] = useState(() => isl.listSigns());
  const [mine, setMine] = useState(() => personal.getData());
  const [syncState, setSyncState] = useState(null);

  useEffect(() => {
    const refresh = () => setTeamSigns(isl.listSigns());
    const refreshMine = () => setMine(personal.getData());
    const off = isl.subscribe(refresh);
    const offMine = personal.subscribe(refreshMine);
    personal.init().then(refreshMine);
    let p = isl.init().then(refresh);
    if (sync) p = p.then(() => isl.sync().then(setSyncState).catch((e) => setSyncState(e.message)));
    return () => { off(); offMine(); };
  }, [sync]);

  const signs = useMemo(() => effectiveSigns(teamSigns, mine), [teamSigns, mine]);
  const resync = () => isl.sync({ force: true }).then(setSyncState).catch((e) => setSyncState(e.message));
  return { signs, teamSigns, mine, syncState, resync };
}
