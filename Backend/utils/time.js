// src/utils/time.js
export const HOBART_TZ = 'Australia/Hobart';

export function formatHobartDateTime(d = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: HOBART_TZ,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short', // e.g., AEST / AEDT
    }).format(d);
  } catch {
    // Fallback (shouldn't happen on modern Node)
    return d.toISOString();
  }
}