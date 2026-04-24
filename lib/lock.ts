/** Returns true when brackets should no longer be editable. */
export function getLockAt(): Date {
  const iso = process.env.NEXT_PUBLIC_LOCK_AT_ISO || '2026-06-11T22:00:00Z';
  return new Date(iso);
}
export function isLocked(now: Date = new Date()): boolean {
  return now >= getLockAt();
}
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return 'Brackets locked';
  const sec = Math.floor(msRemaining / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  if (d || h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
