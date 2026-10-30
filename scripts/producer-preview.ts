// Alpha 1.9.0 — `npm run producer:preview`: the PRIME PRODUCER AVATARS contact sheet (every portrait, every frame and
// backdrop, sizes 32 / 48 / 96 / 160 on dark and light) → preview-screens/producer-avatars.html (open in a browser).
import { PRODUCER_AVATARS, PRODUCER_BACKDROPS, PRODUCER_FRAMES } from '../src/config/producer.config';
import { producerSVG, systemProducerSVG } from '../src/ui/producerArt';
import { ROOT } from './lib/backendKit';
import { fs, path } from './lib/node';

const looks = PRODUCER_AVATARS.map((a, i) => ({ a, look: { avatar: a.id, frame: PRODUCER_FRAMES[i % 4].id, backdrop: PRODUCER_BACKDROPS[i % 4].id } }));
const grid = looks.map(({ a, look }) => `<figure>${producerSVG(look, 160)}<figcaption><b>${a.ru}</b><span>${a.en} · ${a.id}</span></figcaption></figure>`).join('');
const sizes = (bg: string) => `<div class="sizes" style="background:${bg}">${looks.map(({ look }) => `<div>${[32, 48, 96, 160].map((s) => producerSVG(look, s)).join('')}</div>`).join('')}</div>`;
const frames = PRODUCER_FRAMES.map((f) => `<figure>${producerSVG({ avatar: 'director', frame: f.id, backdrop: 'violet' }, 120)}<figcaption><b>${f.ru}</b><span>${f.id}</span></figcaption></figure>`).join('');
const backs = PRODUCER_BACKDROPS.map((b) => `<figure>${producerSVG({ avatar: 'diva', frame: 'studio', backdrop: b.id }, 120)}<figcaption><b>${b.ru}</b><span>${b.id}</span></figcaption></figure>`).join('');
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PRIME PRODUCER AVATARS</title>
<style>body{margin:0;padding:24px;background:#070a1c;color:#eef2ff;font:14px Rubik,system-ui,sans-serif}h1,h2{font-family:Unbounded,Arial Black,sans-serif;letter-spacing:.04em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:18px}figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}figcaption{text-align:center;display:flex;flex-direction:column}figcaption span{color:#8f9ad0;font-size:11px}
.sizes{display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:16px;margin:10px 0}.sizes>div{display:flex;align-items:center;gap:14px}</style></head><body>
<h1>PRIME PRODUCER AVATARS · ${PRODUCER_AVATARS.length}</h1><div class="grid">${grid}<figure>${systemProducerSVG(160)}<figcaption><b>PRIME NETWORK</b><span>системный участник</span></figcaption></figure></div>
<h2>Размеры 32 / 48 / 96 / 160 — тёмный фон</h2>${sizes('#0b1028')}<h2>Светлый фон</h2>${sizes('#eef0f7')}
<h2>Рамки</h2><div class="grid">${frames}</div><h2>Подложки</h2><div class="grid">${backs}</div></body></html>`;
const out = path.join(ROOT, 'preview-screens', 'producer-avatars.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('preview: ' + out);
