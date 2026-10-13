import Phaser from 'phaser';
import { Match, type CombatEvent, type FighterState, type Side } from './combat';
import { UI } from './ui';
import { Sound } from './audio';
import { cardById, type WeaponId } from './data';

type G = Phaser.GameObjects.Graphics;
type C = Phaser.GameObjects.Container;
interface Avatar {
  root: C; body: C; arm: C; legs: C[]; shadow: Phaser.GameObjects.Ellipse;
  recoil: number; flash: number; moving: boolean; lastX: number; lastY: number;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number; }
interface Tracer { x: number; y: number; tx: number; ty: number; life: number; max: number; color: number; heavy: boolean; }
interface Ring { x: number; y: number; life: number; max: number; color: number; radius: number; }

const cyan = 0x66e5ff, pink = 0xff72aa, lime = 0xdfff75;
export class Arena extends Phaser.Scene {
  match: Match | null = null;
  state: 'lobby' | 'countdown' | 'fight' | 'pause' | 'result' = 'lobby';
  private avatars!: Record<Side, Avatar>;
  private atmosphere!: G;
  private audience!: G;
  private effects!: G;
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private rings: Ring[] = [];
  private cheer = 0;
  private visualTime = 0;
  private crowdFrame = -1;
  private lastHUD = 0;
  private intro = 0;
  private introCount = -1;
  private resultIn = 0;
  private resultShown = false;
  private announcer?: Phaser.GameObjects.Text;
  private disposed = false;
  constructor(private ui: UI, private sfx: Sound) { super('arena'); }
  create() {
    this.makeBackground();
    this.atmosphere = this.add.graphics().setDepth(1);
    this.audience = this.add.graphics().setDepth(2);
    this.makeArena();
    this.avatars = { player: this.makeFighter(135, 413, false, 'pulse'), enemy: this.makeFighter(315, 403, true, 'pulse') };
    this.effects = this.add.graphics().setDepth(20);
    this.ui.onPlay = () => this.begin();
    this.ui.onCard = i => this.playCard(i);
    this.ui.onPause = pause => this.pause(pause);
    this.ui.onLobby = () => this.lobby();
    this.ui.onSound = muted => { this.sfx.muted = muted; if (!muted) this.sfx.unlock(); };
    this.sfx.muted = this.ui.preferences.muted;
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (['1', '2', '3'].includes(e.key)) this.playCard(Number(e.key) - 1);
      if (e.key === 'Escape' && (this.state === 'fight' || this.state === 'pause')) this.pause(this.state === 'fight');
    });
    document.addEventListener('visibilitychange', this.visibility);
    this.events.once('shutdown', () => { this.disposed = true; document.removeEventListener('visibilitychange', this.visibility); });
  }
  private visibility = () => { if (document.hidden && (this.state === 'fight' || this.state === 'countdown')) this.pause(true); };
  private previousState: 'fight' | 'countdown' = 'fight';
  pause(paused: boolean) {
    if (paused && (this.state === 'fight' || this.state === 'countdown')) {
      this.previousState = this.state; this.state = 'pause'; this.ui.pause(true);
    } else if (!paused && this.state === 'pause') {
      this.state = this.previousState; this.ui.pause(false); this.sfx.unlock();
      if (this.state === 'countdown') this.ui.show('#pause-button', false);
    }
  }
  lobby() {
    this.state = 'lobby'; this.match = null; this.ui.lobby(); this.clearEffects(); this.rebuildFighters();
    this.announcer?.destroy(); this.announcer = undefined;
  }
  begin() {
    if (this.ui.preferences.deck.length !== 4) return;
    this.sfx.unlock(); this.sfx.muted = this.ui.preferences.muted;
    this.match = new Match(this.ui.preferences.weapon, this.ui.preferences.deck);
    this.state = 'countdown'; this.intro = 0; this.introCount = -1; this.resultShown = false; this.resultIn = 0;
    this.clearEffects(); this.rebuildFighters(); this.ui.begin(this.match); this.announcer?.destroy(); this.announcer = undefined;
  }
  private rebuildFighters() {
    Object.values(this.avatars).forEach(a => { a.root.destroy(); a.shadow.destroy(); });
    this.avatars = { player: this.makeFighter(135, 410, false, this.ui.preferences.weapon), enemy: this.makeFighter(315, 370, true, 'pulse') };
  }
  private clearEffects() { this.particles = []; this.tracers = []; this.rings = []; this.effects.clear(); this.cheer = 0; }
  private playCard(index: number) {
    if (this.state !== 'fight' || !this.match) return;
    if (!this.match.canPlay(index)) return;
    this.match.play(index); this.processEvents(); this.ui.update(this.match);
  }
  private makeBackground() {
    const texture = this.textures.createCanvas('studio', 450, 800)!;
    const ctx = texture.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, 800);
    gradient.addColorStop(0, '#101930'); gradient.addColorStop(.28, '#11152c'); gradient.addColorStop(.58, '#22213e'); gradient.addColorStop(.7, '#10182f'); gradient.addColorStop(1, '#0c1427');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 450, 800);
    const vignette = ctx.createRadialGradient(225, 360, 30, 225, 360, 340);
    vignette.addColorStop(0, '#46547a30'); vignette.addColorStop(1, '#03071866');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, 450, 800); texture.refresh();
    this.add.image(225, 400, 'studio');
    const g = this.add.graphics();
    g.lineStyle(1, 0x53618c, .12);
    for (let x = 0; x < 450; x += 25) { g.lineBetween(x, 0, x, 800); }
    for (let y = 0; y < 800; y += 25) { g.lineBetween(0, y, 450, y); }
    g.fillStyle(0x060b19, .65); g.fillRect(0, 510, 450, 290);
    g.lineStyle(1, 0x8192cb, .1); g.lineBetween(25, 510, 425, 510);
    // Broadcast gantries and edge LEDs.
    for (const x of [14, 428]) {
      g.fillStyle(0x080e20); g.fillRect(x, 220, 8, 285);
      g.lineStyle(1, 0x475577, .5);
      for (let y = 225; y < 490; y += 20) { g.lineBetween(x, y, x + 8, y + 15); g.lineBetween(x + 8, y, x, y + 15); }
      for (let y = 245; y < 480; y += 37) {
        g.fillStyle(x === 14 ? cyan : pink, .11); g.fillRoundedRect(x - 4, y - 2, 16, 23, 4);
        g.fillStyle(x === 14 ? cyan : pink, .9); g.fillRect(x + 2, y + 2, 4, 15);
      }
    }
    const lamp = (x: number, angle: number, color: number) => {
      const rig = this.add.container(x, 253).setAngle(angle).setDepth(6);
      const body = this.add.graphics();
      body.fillStyle(0x050a18); body.fillRoundedRect(-14, -10, 28, 19, 5); body.lineStyle(2, 0x56617d); body.strokeRoundedRect(-14, -10, 28, 19, 5);
      body.fillStyle(color); body.fillRoundedRect(-10, 3, 20, 6, 2); rig.add(body);
    };
    lamp(48, -24, cyan); lamp(402, 24, pink);
    this.add.text(225, 273, 'P R I M E   T I M E   N E T W O R K', { fontFamily: 'Arial', fontSize: '7px', color: '#a4b1df' }).setOrigin(.5).setAlpha(.65).setDepth(6);
  }
  private polygon(g: G, points: number[], fill: number, alpha = 1, stroke?: number, line = 1) {
    const vertices = Array.from({ length: points.length / 2 }, (_, i) => ({ x: points[i * 2], y: points[i * 2 + 1] }));
    g.fillStyle(fill, alpha); g.fillPoints(vertices, true);
    if (stroke !== undefined) { g.lineStyle(line, stroke, alpha); g.strokePoints(vertices, true); }
  }
  private makeArena() {
    const g = this.add.graphics().setDepth(3).setY(-9);
    const outer = [72, 315, 361, 315, 422, 439, 359, 507, 91, 507, 28, 439];
    g.fillStyle(0x040916, .6); g.fillEllipse(225, 487, 415, 72);
    this.polygon(g, [28, 439, 91, 507, 359, 507, 422, 439, 422, 457, 359, 527, 91, 527, 28, 457], 0x090e20, 1, 0x28344d, 2);
    this.polygon(g, [91, 507, 359, 507, 359, 527, 91, 527], 0x14203b);
    for (let x = 102; x < 350; x += 13) { g.fillStyle(0x7594cf, .32); g.fillRect(x, 514, 7, 4); }
    this.polygon(g, outer, 0x1a2744, 1, 0x4b6d96, 2);
    this.polygon(g, [83, 325, 351, 325, 406, 437, 350, 493, 100, 493, 44, 437], 0x273959, 1, 0x7395bd, 1);
    this.polygon(g, [96, 338, 340, 338, 389, 435, 341, 480, 109, 480, 62, 435], 0x344969, 1, 0x526b8b, 1);
    // Fine perspective floor tile lines.
    g.lineStyle(1, 0xa9cee8, .07);
    for (let i = 0; i < 7; i++) { const yy = 348 + i * 20; const start = 92 - i * 5; g.lineBetween(start, yy, 345 + i * 5, yy); }
    for (let i = 0; i < 8; i++) { const xx = 105 + i * 31; g.lineBetween(xx, 338, (xx - 225) * 1.35 + 225, 480); }
    g.lineStyle(2, 0xd4e7ff, .13); g.strokeEllipse(225, 415, 145, 74);
    g.lineStyle(1, 0xd4e7ff, .1); g.strokeEllipse(225, 415, 160, 82);
    // Stylized lightning insignia painted on the stage.
    this.polygon(g, [236, 384, 199, 419, 220, 419, 212, 445, 250, 407, 228, 407], 0xbcd4e8, .12);
    g.lineStyle(3, cyan, .8); g.lineBetween(45, 438, 101, 494); g.lineBetween(101, 494, 220, 494);
    g.lineStyle(3, pink, .8); g.lineBetween(230, 494, 350, 494); g.lineBetween(350, 494, 406, 438);
    g.lineStyle(8, cyan, .06); g.lineBetween(45, 438, 101, 494); g.lineBetween(101, 494, 220, 494);
    g.lineStyle(8, pink, .06); g.lineBetween(230, 494, 350, 494); g.lineBetween(350, 494, 406, 438);
    // Back safety rails, with rings kept visually clear.
    g.lineStyle(2, 0x8399c0, .4); g.lineBetween(72, 314, 362, 314); g.lineBetween(72, 302, 362, 302);
    for (const [x, y] of [[72, 315], [362, 315], [29, 440], [421, 440]]) {
      g.fillStyle(0x101e36); g.fillRoundedRect(x - 4, y - 38, 8, 44, 3);
      g.fillStyle(x < 225 ? cyan : pink, .8); g.fillRect(x - 2, y - 34, 4, 18);
      g.fillStyle(0xb1ceee, .4); g.fillEllipse(x, y - 39, 9, 5);
    }
  }
  private makeFighter(x: number, y: number, enemy: boolean, weapon: WeaponId): Avatar {
    const accent = enemy ? pink : cyan, jacket = enemy ? 0x9c4f95 : 0x31a6c6, light = enemy ? 0xd783bb : 0x73dded;
    const skin = enemy ? 0xc98562 : 0xdca47f;
    const shadow = this.add.ellipse(x, y + 5, 59, 19, 0x030c20, .48).setDepth(7);
    const root = this.add.container(x, y).setDepth(10).setScale(enemy ? -1.08 : 1.08, 1.08);
    const body = this.add.container(0, 0);
    const legs: C[] = [];
    for (const side of [-1, 1]) {
      const leg = this.add.container(side * 10, -29), g = this.add.graphics();
      this.polygon(g, [-8, -4, 7, -4, 9, 20, 4, 29, -9, 28], 0x121c36, 1, 0x070d1c, 2);
      this.polygon(g, [-5, 3, 4, 3, 5, 17, -4, 19], enemy ? 0x383352 : 0x2c4a60);
      g.fillStyle(0x0a1024); g.fillRoundedRect(-11, 22, 24, 10, 3);
      g.fillStyle(accent, .7); g.fillRoundedRect(-9, 29, 21, 3, 1);
      g.fillStyle(0x677994, .7); g.fillRect(2, 23, 6, 3);
      leg.add(g); legs.push(leg); root.add(leg);
    }
    const backArm = this.add.graphics();
    this.polygon(backArm, [-17, -66, -25, -62, -28, -43, -19, -37, -11, -47], jacket, 1, 0x11172c, 2);
    backArm.fillStyle(0x101a30); backArm.fillRoundedRect(-27, -43, 12, 12, 4); body.add(backArm);
    const torso = this.add.graphics();
    this.polygon(torso, [-19, -70, 13, -70, 22, -60, 15, -31, -14, -31, -24, -57], jacket, 1, 0x09152b, 2.5);
    this.polygon(torso, [-18, -66, -9, -68, -7, -35, -15, -35, -21, -55], light);
    this.polygon(torso, [-5, -65, 13, -66, 15, -43, -4, -43], enemy ? 0x46233f : 0x143e54);
    torso.lineStyle(2, 0xd6efff, .5); torso.lineBetween(-5, -66, -5, -37);
    this.polygon(torso, [7, -61, 0, -51, 6, -51, 3, -44, 13, -55, 7, -55], enemy ? 0xffb1d7 : 0xd5fbff);
    torso.fillStyle(0x101b31); torso.fillRoundedRect(-16, -35, 33, 7, 2);
    torso.fillStyle(0xa5b8c7); torso.fillRect(-3, -34, 7, 5); body.add(torso);
    const head = this.add.graphics();
    head.fillStyle(0x8d5c4e); head.fillRoundedRect(-6, -79, 14, 13, 3);
    head.fillStyle(skin); head.fillRoundedRect(-14, -105, 30, 32, 11);
    this.polygon(head, [1, -101, 15, -98, 16, -84, 12, -76, 2, -73], enemy ? 0xa55d50 : 0xba7d60);
    head.fillStyle(0xefbc96, .8); head.fillEllipse(-7, -93, 8, 15);
    head.fillStyle(0x11233a); head.fillRoundedRect(-6, -94, 25, 11, 4);
    head.fillStyle(accent); head.fillRoundedRect(-1, -92, 18, 5, 2);
    head.fillStyle(0xffffff, .8); head.fillRect(2, -92, 9, 2);
    head.fillStyle(skin); head.fillEllipse(17, -82, 8, 8);
    head.lineStyle(1.5, 0x6c3e3f); head.lineBetween(6, -78, 13, -78);
    if (enemy) {
      this.polygon(head, [-14, -96, -19, -109, -11, -108, -9, -120, 0, -114, 9, -119, 13, -108, 19, -104, 12, -98, 1, -103, -6, -99], 0xdce1ef, 1, 0x2b2840, 2);
      this.polygon(head, [-9, -110, -3, -114, 6, -109, 13, -108, 7, -103, -1, -106], 0x94a0be);
    } else {
      this.polygon(head, [-14, -87, -18, -99, -14, -111, -5, -115, 8, -113, 19, -105, 16, -99, 4, -101, -4, -98, -9, -88], 0x122135, 1, 0x07101f, 2);
      this.polygon(head, [-8, -109, 0, -112, 12, -107, 5, -104, -3, -104], 0x52c6df);
      head.fillStyle(accent); head.fillRoundedRect(-17, -93, 6, 12, 2);
    }
    body.add(head);
    const arm = this.add.container(13, -57), a = this.add.graphics();
    this.polygon(a, [-7, -9, 7, -11, 13, 0, 26, 1, 26, 11, 9, 12, -3, 5], jacket, 1, 0x10152b, 2);
    this.polygon(a, [-5, -8, 4, -9, 9, -1, 0, 1], light);
    a.fillStyle(0x132138); a.fillRoundedRect(20, -2, 12, 14, 4);
    a.fillStyle(skin); a.fillRoundedRect(26, -3, 10, 10, 3);
    a.fillStyle(0x0b1428); a.fillRoundedRect(28, -12, weapon === 'scatter' ? 37 : 27, 14, 3);
    a.fillStyle(0x6c82a1); a.fillRoundedRect(30, -13, weapon === 'scatter' ? 33 : 22, 7, 2);
    a.fillStyle(0xb0c4d6); a.fillRect(weapon === 'scatter' ? 59 : 48, -10, 5, 9);
    a.fillStyle(accent); a.fillRect(33, -10, 8, 3);
    if (weapon === 'scatter') { a.fillStyle(0x202e46); for (let i = 0; i < 3; i++) a.fillRect(44 + i * 4, -12, 2, 10); }
    arm.add(a); body.add(arm); root.add(body);
    return { root, body, arm, legs, shadow, recoil: 0, flash: 0, moving: false, lastX: x, lastY: y };
  }
  private drawAtmosphere() {
    const g = this.atmosphere; g.clear();
    const t = this.visualTime;
    for (const [x, base, color] of [[48, 280, cyan], [402, 175, pink]] as const) {
      const sway = Math.sin(t * .42 + x) * 70;
      for (let layer = 0; layer < 3; layer++) {
        const width = 55 + layer * 19;
        this.polygon(g, [x - 6, 256, x + 6, 256, base + sway + width, 497, base + sway - width, 497], color, .018 + (2 - layer) * .012);
      }
    }
    g.fillStyle(cyan, .018); g.fillEllipse(150, 413, 220, 140);
    g.fillStyle(pink, .018); g.fillEllipse(310, 400, 220, 140);
    if (this.match?.showtime) { g.fillStyle(lime, .04 + Math.sin(t * 5) * .01); g.fillEllipse(225, 405, 390, 220); }
    // Drifting dust, very few primitives.
    for (let i = 0; i < 13; i++) {
      const x = (i * 73 + Math.sin(t * .3 + i) * 25) % 420 + 15;
      const y = 280 + ((i * 41 - t * 9) % 190 + 190) % 190;
      g.fillStyle(i % 2 ? pink : cyan, .15); g.fillCircle(x, y, 1);
    }
  }
  private drawAudience() {
    const frame = Math.floor(this.visualTime * 16);
    if (frame === this.crowdFrame) return; this.crowdFrame = frame;
    const g = this.audience; g.clear();
    const t = this.visualTime;
    for (let row = 0; row < 3; row++) {
      const y = 280 + row * 13;
      g.fillStyle(0x080e20, .7); g.fillRoundedRect(35, y + 4, 380, 10, 2);
      for (let col = 0; col < 26; col++) {
        const x = 40 + col * 14.6 + (row % 2) * 6;
        const wave = Math.sin(t * (this.cheer > 0 ? 12 : 2) + col * 2 + row) * (this.cheer > 0 ? 3 : .8);
        const color = [0x384365, 0x594664, 0x2e5a70, 0x6a5978, 0x344a64][(col * 7 + row) % 5];
        g.fillStyle(color); g.fillRoundedRect(x - 3, y + wave, 7, 8, 2);
        g.fillStyle(0x7e7190, .7); g.fillCircle(x + .5, y - 2 + wave, 3);
        if (this.cheer > 0 && col % 3 === 0) {
          g.lineStyle(2, color); g.lineBetween(x - 3, y + 2 + wave, x - 6, y - 5 + wave); g.lineBetween(x + 4, y + 2 + wave, x + 7, y - 6 + wave);
        }
        if (col % 9 === 2) { g.fillStyle(col % 2 ? pink : cyan, .6); g.fillRect(x + 5, y - 3 + wave, 2, 3); }
      }
    }
  }
  private animateAvatar(side: Side, f: FighterState | null, dt: number) {
    const a = this.avatars[side], t = this.visualTime, enemy = side === 'enemy';
    const x = f?.x ?? (enemy ? 315 : 135), y = f?.y ?? (enemy ? 405 : 413);
    a.moving = Math.hypot(x - a.lastX, y - a.lastY) > .12;
    a.lastX = x; a.lastY = y;
    a.root.setPosition(x, y).setDepth(8 + y / 100);
    a.shadow.setPosition(x, y + 4).setScale(f?.dodge ? 1.3 : 1);
    a.recoil = Math.max(0, a.recoil - dt * 6); a.flash = Math.max(0, a.flash - dt * 6);
    const dead = f && f.hp <= 0;
    const won = this.state === 'result' && this.match?.winner === side;
    a.body.y = Math.sin(t * 3.8 + (enemy ? 2 : 0)) * 1.4 - (won ? Math.abs(Math.sin(t * 6)) * 6 : 0);
    a.body.x = -a.recoil * 4;
    a.body.rotation = dead ? -.58 : a.recoil * -.08;
    a.root.alpha = dead ? .5 : a.flash > 0 ? .65 + Math.sin(t * 70) * .3 : 1;
    a.legs.forEach((leg, i) => { leg.rotation = a.moving ? Math.sin(t * 13 + i * Math.PI) * .2 : Math.sin(t * 2 + i) * .02; });
    const target = this.match?.[enemy ? 'player' : 'enemy'];
    a.arm.rotation = won ? -1.6 : dead ? .5 : target ? Phaser.Math.Clamp(Math.atan2(target.y - y, Math.abs(target.x - x)), -.35, .35) - a.recoil * .12 : -.08;
  }
  private drawStatus(f: FighterState) {
    const g = this.effects, c = f.side === 'player' ? cyan : pink, t = this.visualTime;
    if (f.dodge > 0) {
      for (let i = 1; i <= 3; i++) { g.lineStyle(3, c, .25 / i); g.strokeEllipse(f.x - (f.side === 'player' ? 1 : -1) * i * 20, f.y - 43, 44, 76); }
    }
    if (f.smoke > 0) {
      for (let i = 0; i < 7; i++) {
        g.fillStyle(0xaf9cd4, .09 + (i % 2) * .025);
        g.fillCircle(f.x + Math.sin(t + i * 2) * 36, f.y - 20 - (i % 3) * 22 + Math.cos(t * 1.4 + i) * 9, 26 + i % 3 * 6);
      }
    }
    if (f.shield > 0) {
      g.fillStyle(c, .05); g.fillEllipse(f.x, f.y - 52, 91, 126);
      g.lineStyle(3, c, .12); g.strokeEllipse(f.x, f.y - 52, 96, 130);
      g.lineStyle(1.5, c, .65); g.strokeEllipse(f.x, f.y - 52, 88, 124);
      for (let i = 0; i < 3; i++) {
        const xx = f.x + Math.sin(t * 1.8 + i * 2) * 38;
        g.fillStyle(0xe5faff, .8); g.fillCircle(xx, f.y - 52 + Math.cos(t * 1.8 + i * 2) * 52, 2);
      }
    }
    if (f.boost > 0) {
      g.lineStyle(2, 0xff90c2, .6); g.strokeEllipse(f.x, f.y + 2, 66 + Math.sin(t * 10) * 8, 18);
      for (let i = 0; i < 4; i++) { const yy = (t * 50 + i * 22) % 85; g.lineStyle(2, pink, .4); g.lineBetween(f.x - 25 + i * 17, f.y - yy, f.x - 25 + i * 17, f.y - yy - 8); }
    }
    if (f.stun > 0) {
      g.lineStyle(2, lime, .9);
      for (let i = 0; i < 3; i++) { const xx = f.x + Math.sin(t * 5 + i * 2) * 20, yy = f.y - 131 + Math.cos(t * 5 + i * 2) * 5; g.lineBetween(xx - 4, yy, xx, yy - 5); g.lineBetween(xx, yy - 5, xx + 4, yy); }
    }
    if (f.side === 'enemy' && this.match && this.match.warning > 0) {
      const progress = 1 - this.match.warning / 1.35;
      g.lineStyle(2, pink, .5 + progress * .5); g.strokeEllipse(f.x, f.y + 3, 63 + progress * 15, 22 + progress * 5);
      g.lineStyle(2, pink, .3); g.lineBetween(f.x - 30, f.y - 54, this.match.player.x + 25, this.match.player.y - 54);
      g.fillStyle(pink, .1 + progress * .1); g.fillCircle(f.x - 51, f.y - 61, 8 + progress * 9);
    }
  }
  private burst(x: number, y: number, color: number, count = 12, strength = 1) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = (35 + Math.random() * 105) * strength;
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 15, life: .28 + Math.random() * .3, max: .6, color, size: 1.5 + Math.random() * 2.5 });
    }
    if (this.particles.length > 110) this.particles.splice(0, this.particles.length - 110);
  }
  private ring(x: number, y: number, color: number, radius = 60) { this.rings.push({ x, y, color, radius, life: .5, max: .5 }); }
  private float(x: number, y: number, label: string, color: string, size = 16) {
    const text = this.add.text(x, y, label, { fontFamily: 'Arial', fontSize: `${size}px`, color, fontStyle: 'bold', stroke: '#11182e', strokeThickness: 3 }).setOrigin(.5).setDepth(25);
    this.tweens.add({ targets: text, y: y - 30, alpha: 0, duration: 750, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
  }
  private shout(label: string, color = '#dfff75', small = false) {
    this.announcer?.destroy();
    this.announcer = this.add.text(225, small ? 470 : 263, label, { fontFamily: 'Impact, Arial Black, sans-serif', fontSize: small ? '23px' : '37px', color, stroke: '#10172e', strokeThickness: 5 }).setOrigin(.5).setDepth(30).setAngle(-4);
    const text = this.announcer;
    this.tweens.add({ targets: text, scale: { from: 1.35, to: 1 }, duration: 190, ease: 'Back.easeOut' });
    this.tweens.add({ targets: text, alpha: 0, y: text.y - 15, delay: 900, duration: 300, onComplete: () => text.destroy() });
  }
  private processEvents() {
    if (!this.match) return;
    this.match.drainEvents().forEach(event => this.event(event));
  }
  private event(e: CombatEvent) {
    if (!this.match) return;
    if (e.type === 'shot') {
      const f = this.match[e.side], a = this.avatars[e.side], dir = e.side === 'player' ? 1 : -1;
      a.recoil = e.heavy ? 1.6 : 1;
      const x = f.x + dir * (e.scatter ? 77 : 66), y = f.y - 62;
      this.burst(x, y, e.heavy ? lime : 0xffde9b, e.heavy ? 13 : 5, .5);
      for (let i = 0; i < (e.scatter ? 3 : 1); i++) this.tracers.push({ x, y, tx: e.targetX + (i - 1) * (e.scatter ? 5 : 0), ty: e.targetY - 61 + (i - 1) * (e.scatter ? 7 : 0), life: e.heavy ? .24 : .16, max: e.heavy ? .24 : .16, color: e.heavy ? lime : e.side === 'player' ? cyan : pink, heavy: e.heavy });
      this.sfx.shot(e.heavy);
    } else if (e.type === 'hit') {
      const f = this.match[e.side], a = this.avatars[e.side]; a.flash = 1;
      const c = e.blocked ? cyan : e.critical ? lime : e.side === 'player' ? pink : 0xffce8d;
      this.burst(f.x, f.y - 58, c, e.critical ? 22 : e.blocked ? 6 : 9);
      this.float(f.x + (e.side === 'player' ? -28 : 28), f.y - 119, `${e.blocked ? '−' : ''}${e.damage}`, e.blocked ? '#8be8ff' : e.critical ? '#e5ff89' : '#ffffff', e.critical ? 24 : 15);
      if (e.critical && !e.blocked) { this.cameras.main.shake(115, .0035); this.cheer = 1.5; this.shout('CRITICAL!', '#e9ff90', true); }
      this.sfx.hit();
    } else if (e.type === 'miss') {
      const f = this.match[e.side]; this.float(f.x, f.y - 120, f.dodge > 0 ? 'УКЛОНЕНИЕ' : 'МИМО', '#a7c0dc', 9);
    } else if (e.type === 'cast') {
      const f = this.match[e.side], color = Phaser.Display.Color.HexStringToColor(cardById(e.card).color).color;
      this.ring(f.x, f.y - 35, color, e.card === 'smoke' ? 95 : 65);
      this.burst(f.x, f.y - 48, color, 12, .7);
      if (e.side === 'player') this.sfx.card();
      if (e.card === 'shock') {
        const target = this.match[e.side === 'player' ? 'enemy' : 'player'];
        this.tracers.push({ x: f.x, y: f.y - 60, tx: target.x, ty: target.y - 60, life: .24, max: .24, color: lime, heavy: true });
        this.burst(target.x, target.y - 60, lime, 17); this.cheer = .8;
      }
    } else if (e.type === 'warning' && e.active) this.sfx.warning();
    else if (e.type === 'combo') { this.shout(`COMBO ×${e.count}`, '#8deeff', true); this.cheer = 1.4; }
    else if (e.type === 'showtime' && e.active) {
      this.shout('SHOWTIME!'); this.cheer = 6; this.sfx.win(); this.ui.toast('SHOWTIME: быстрее атаки, больше урона и энергии!');
      for (let i = 0; i < 5; i++) this.burst(60 + i * 80, 300, i % 2 ? pink : lime, 10);
    } else if (e.type === 'finish') {
      this.state = 'result'; this.resultIn = 1.5; this.ui.update(this.match); this.ui.finishing(e.winner); this.cheer = 4;
      if (e.winner === 'player') { this.sfx.win(); this.shout('NEON WINS!', '#dfff75', true); }
      else this.sfx.lose();
    }
  }
  private drawEffects(dt: number) {
    const g = this.effects; g.clear();
    if (this.match) { this.drawStatus(this.match.player); this.drawStatus(this.match.enemy); }
    for (const ring of this.rings) {
      ring.life -= dt; const p = 1 - ring.life / ring.max;
      g.lineStyle(2 * (1 - p), ring.color, Math.max(0, 1 - p)); g.strokeEllipse(ring.x, ring.y, 15 + p * ring.radius * 2, 10 + p * ring.radius);
    }
    this.rings = this.rings.filter(r => r.life > 0);
    for (const tracer of this.tracers) {
      tracer.life -= dt; const p = Phaser.Math.Clamp(1 - tracer.life / tracer.max, 0, 1);
      const x = Phaser.Math.Linear(tracer.x, tracer.tx, p), y = Phaser.Math.Linear(tracer.y, tracer.ty, p);
      const px = Phaser.Math.Linear(tracer.x, tracer.tx, Math.max(0, p - .3)), py = Phaser.Math.Linear(tracer.y, tracer.ty, Math.max(0, p - .3));
      g.lineStyle(tracer.heavy ? 9 : 5, tracer.color, .1); g.lineBetween(px, py, x, y);
      g.lineStyle(tracer.heavy ? 3 : 1.8, tracer.color, .95); g.lineBetween(px, py, x, y);
      g.fillStyle(0xffffff); g.fillCircle(x, y, tracer.heavy ? 3 : 1.5);
    }
    this.tracers = this.tracers.filter(s => s.life > 0);
    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 110 * dt;
      g.fillStyle(p.color, Math.max(0, p.life / p.max)); g.fillCircle(p.x, p.y, p.size * Math.min(1, p.life * 5));
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }
  update(_time: number, delta: number) {
    if (this.disposed || !this.avatars) return;
    const dt = Math.min(delta / 1000, .05);
    if (this.state === 'pause') return;
    this.visualTime += dt; this.cheer = Math.max(0, this.cheer - dt);
    this.drawAtmosphere(); this.drawAudience();
    if (this.state === 'countdown') {
      this.intro += dt;
      const count = Math.floor(this.intro);
      if (count !== this.introCount) { this.introCount = count; this.ui.count(count < 3 ? `${3 - count}` : 'GO!'); this.sfx.count(count >= 3); }
      if (this.intro >= 3.6) { this.state = 'fight'; this.ui.start(); }
    } else if (this.state === 'fight' && this.match) {
      this.match.step(dt); this.processEvents();
      this.lastHUD += dt;
      if (this.lastHUD > .05) { this.ui.update(this.match); this.lastHUD = 0; }
    } else if (this.state === 'result' && this.match) {
      this.resultIn -= dt;
      if (!this.resultShown && this.resultIn <= 0) { this.resultShown = true; this.ui.result(this.match); }
      if (this.match.winner === 'player' && Math.random() < .15 && this.cheer > 0) {
        this.particles.push({ x: Math.random() * 450, y: 220, vx: (Math.random() - .5) * 60, vy: 35, life: 1.5, max: 1.5, color: [lime, cyan, pink][Math.floor(Math.random() * 3)], size: 2 });
      }
    }
    this.animateAvatar('player', this.match?.player ?? null, dt); this.animateAvatar('enemy', this.match?.enemy ?? null, dt);
    this.drawEffects(dt);
  }
}
