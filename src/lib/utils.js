import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class joiner: later utilities win over earlier ones. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Zero-padded clock, e.g. "09:04". */
export function clockString(date = new Date()) {
  return String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
}

/** "04:28" from a second count. */
export function durationString(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
