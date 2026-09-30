/**
 * One-shot hand-off between screens: "open My signs on THIS step". The
 * developer section sets it and navigates; My signs takes it on mount.
 *   { action: 'new' } | { action: 'edit', signId } | { action: 'record', signId }
 */
let intent = null;

export const setIntent = (value) => { intent = value; };
export function takeIntent() {
  const v = intent;
  intent = null;
  return v;
}

export default { setIntent, takeIntent };
