// DEV ONLY (Alpha 1.9.8) — is every visible control of a screen really under the finger?
//
// Loaded by main.ts only under `import.meta.env.DEV`. In the dev console: __tapAudit() for the screen shown now,
// __tapAuditAll() for the main screens. For each visible button / link / field it asks the browser what a tap at the
// control's centre would hit: anything else on top (a decorative ::before glow, a transparent layer) makes it a
// «dead» control on a phone — the cause of the studio pencil that «did nothing» on an iPhone (1.9.8).
import type { Game } from '../game/Game';

interface Dead {
  control: string;
  covered: string;
}

function label(e: Element): string {
  const h = e as HTMLElement;
  const cls = typeof h.className === 'string' ? h.className.split(' ').filter(Boolean).slice(0, 3).join('.') : '';
  const act = h.dataset?.act ? `[data-act=${h.dataset.act}]` : '';
  const txt = (h.getAttribute('aria-label') || h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return `${h.tagName.toLowerCase()}${cls ? '.' + cls : ''}${act}${txt ? ` «${txt}»` : ''}`;
}

export function tapAudit(root: ParentNode = document): { controls: number; dead: Dead[] } {
  const sel = 'button:not([disabled]), a[href], input:not([type=hidden]), [data-act], [role=button], [role=tab], select, textarea';
  const dead: Dead[] = [];
  let controls = 0;
  for (const c of root.querySelectorAll<HTMLElement>(sel)) {
    const r = c.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const st = getComputedStyle(c);
    if (st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none') continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue; // off screen (scrolled away)
    // inside a scroller, only the part it shows counts
    let clipped = false;
    for (let p = c.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(ps.overflowY + ps.overflowX)) {
        const pr = p.getBoundingClientRect();
        if (y < pr.top || y > pr.bottom || x < pr.left || x > pr.right) {
          clipped = true;
          break;
        }
      }
    }
    if (clipped) continue;
    controls++;
    const hits = (px: number, py: number) => {
      const t = document.elementFromPoint(px, py);
      return !!t && (t === c || c.contains(t) || t.closest(sel) === c);
    };
    if (hits(x, y)) continue;
    // a link wrapped over two lines: the centre of its box is between the lines — try each line instead
    if ([...c.getClientRects()].some((f) => hits(f.left + f.width / 2, f.top + f.height / 2))) continue;
    const top = document.elementFromPoint(x, y);
    dead.push({ control: label(c), covered: top ? label(top) : '—' });
  }
  return { controls, dead };
}

export function installTapAudit(game: Game): void {
  const w = window as unknown as Record<string, unknown>;
  w.__tapAudit = () => tapAudit(document.querySelector('.screen.active') ?? document);
  w.__tapAuditAll = async () => {
    const out: Record<string, { controls: number; dead: Dead[] }> = {};
    for (const s of ['menu', 'career', 'roster', 'collection', 'shop', 'events', 'profile', 'modes', 'league'] as const) {
      try {
        game.goto(s as never);
      } catch {
        continue;
      }
      await new Promise((r) => setTimeout(r, 450));
      const screen = document.querySelector('.screen.active') ?? document;
      // the whole screen, not only what fits: its vertical scroller is walked from top to bottom
      const sc = screen.querySelector<HTMLElement>('.scroll, .fill.scroll');
      const seen = new Set<string>();
      const dead: Dead[] = [];
      let controls = 0;
      for (let y = 0, steps = 0; steps < 40; steps++) {
        if (sc) sc.scrollTop = y;
        await new Promise((r) => setTimeout(r, 60));
        const r = tapAudit(screen);
        controls = Math.max(controls, r.controls);
        for (const d of r.dead) {
          const k = d.control + d.covered;
          if (!seen.has(k)) {
            seen.add(k);
            dead.push(d);
          }
        }
        if (!sc || y >= sc.scrollHeight - sc.clientHeight) break;
        y = Math.min(sc.scrollHeight - sc.clientHeight, y + Math.max(120, sc.clientHeight * 0.7));
      }
      if (sc) sc.scrollTop = 0;
      out[s] = { controls, dead };
    }
    game.goto('menu');
    return out;
  };
}
