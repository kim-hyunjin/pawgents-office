// Text helpers for display: one line, a length cap, markdown noise stripped. Safe anywhere (browser and server).

export function oneLine(s?: unknown) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(v: unknown, n: number) {
  const s = String(v ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Strip code fences / markdown noise so a bubble reads naturally. */
export function cleanText(v: unknown, n = 280) {
  const s = String(v ?? '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ');
  return truncate(oneLine(s), n);
}
