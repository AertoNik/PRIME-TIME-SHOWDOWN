const paths: Record<string, string> = {
  dash: '<path d="m14 4-8 9h6l-2 7 9-11h-6l1-5Z"/><path d="M3 6h5M2 18h5"/>',
  crosshair: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/><circle cx="12" cy="12" r="1"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  smoke: '<path d="M6 18a4 4 0 0 1-1-8 5 5 0 0 1 9-4 5 5 0 0 1 5 8 3 3 0 0 1-2 5H7m1-5h8M9 22h6"/>',
  bolt: '<path d="m14 2-9 12h7l-2 8 9-13h-7l2-7Z"/>',
  fast: '<path d="m3 5 8 7-8 7m9-14 8 7-8 7"/>',
  play: '<path d="m8 4 13 8-13 8V4Z"/>',
  weapon: '<path d="M3 7h17v5H10l-2 7H4l2-7H3V7Zm10 5v3h4v-3"/>',
  trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4m-4 2v6m-4 1h8"/>',
  settings: '<path d="m10 3 4 0 1 3 3 1 3-1 2 4-3 2v3l2 2-2 3-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-3 2-2v-3l-2-2 2-4 3 1 3-1 1-3Z"/><circle cx="12" cy="13" r="3"/>',
  fans: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-4a6 6 0 0 1 12 0v4M17 5a3 3 0 0 1 0 6m1 3c3 0 4 2 4 5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="m14 7-5 5h6l-5 5"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  sound: '<path d="M3 9h4l5-5v16l-5-5H3V9Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z"/>',
};
export function icon(name: string, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.star}</svg>`; }
export function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
