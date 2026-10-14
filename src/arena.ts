import * as THREE from 'three';
import { createGraphicsContext } from './graphics';
import { Character, cube, cylinder, material, disposeShared } from './characters';
import { Effects } from './effects';
import { Combat, type CombatEvent } from './combat';
import type { WeaponId } from './data';
function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const c = canvas.getContext('2d')!; draw(c); const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t; }
export class Arena {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-6, 6, 10, -10, 0.1, 100);
  player = new Character(); enemy = new Character(true);
  effects = new Effects();
  mode: 'lobby' | 'battle' = 'lobby';
  preview = false;
  private textures: THREE.Texture[] = [];
  private beams: THREE.Mesh[] = [];
  private crowd: THREE.InstancedMesh;
  private time = 0;
  private cheer = 0;
  private tickerCanvas = document.createElement('canvas');
  private tickerTexture: THREE.CanvasTexture;
  private tickerKey = '';
  private ledPanels: THREE.Mesh[] = [];
  private targetPoint = new THREE.Vector3();
  private viewTarget = new THREE.Vector3();
  private battlePosition = new THREE.Vector3(4.5, 15.5, 21);
  private lobbyPosition = new THREE.Vector3(7.5, 7, 14);
  private fpsTime = 0; private fpsFrames = 0; private slowWindows = 0;
  private low = false;
  private resizeObserver: ResizeObserver;
  private lobbyFighter = new Combat('pistol', ['dash', 'power', 'shield', 'shock'], () => 0.5);
  private key: THREE.DirectionalLight;
  private onLost = (e: Event) => { e.preventDefault(); this.contextChanged(false); };
  private onRestored = () => { this.contextChanged(true); this.resize(); };
  constructor(private host: HTMLElement, private contextChanged: (ok: boolean) => void) {
    const graphics = createGraphicsContext();
    this.renderer = new THREE.WebGLRenderer({ canvas: graphics.canvas, context: graphics.context, antialias: graphics.antialias, alpha: false });
    this.renderer.setClearColor(0x14252f); this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.42;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);
    this.scene.fog = new THREE.FogExp2(0x14252f, 0.024);
    this.scene.add(new THREE.HemisphereLight(0xb8d8df, 0x254b59, 2.5));
    this.key = new THREE.DirectionalLight(0xffedcf, 5.1); this.key.position.set(-6, 12, 7); this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024); Object.assign(this.key.shadow.camera, { left: -9, right: 9, top: 10, bottom: -10, far: 35 }); this.key.shadow.bias = -0.001; this.key.shadow.normalBias = 0.025; this.scene.add(this.key);
    const rim = new THREE.DirectionalLight(0x55dddf, 2.3); rim.position.set(6, 6, -8); this.scene.add(rim);
    const stage = new THREE.Group(); this.scene.add(stage);
    cube(stage, 0x0b111a, 25, 0.4, 25, 0, -0.85);
    cube(stage, 0x171f2b, 10.5, 0.65, 11.8, 0, -0.43, 0, 0.4);
    cube(stage, 0x384c56, 10.2, 0.12, 11.5, 0, -0.06, 0, 0.1);
    cube(stage, 0x294954, 9.5, 0.04, 10.8, 0, 0.02);
    // Inlaid floor markings and printed television-show emblem.
    const floor = canvasTexture(1024, 1024, c => {
      c.clearRect(0, 0, 1024, 1024); c.strokeStyle = '#a1d4d738'; c.lineWidth = 3;
      for (let p = 128; p < 1024; p += 128) { c.beginPath(); c.moveTo(p, 0); c.lineTo(p, 1024); c.stroke(); c.beginPath(); c.moveTo(0, p); c.lineTo(1024, p); c.stroke(); }
      c.strokeStyle = '#8af5d8ad'; c.lineWidth = 8; c.strokeRect(50, 50, 924, 924); c.beginPath(); c.arc(512, 512, 250, 0, Math.PI * 2); c.stroke();
      c.save(); c.translate(512, 512); c.rotate(-0.16); c.fillStyle = '#c9eadb90'; c.font = '900 112px sans-serif'; c.textAlign = 'center'; c.fillText('PRIME', 0, -12); c.fillText('TIME', 0, 95); c.font = 'bold 30px sans-serif'; c.fillStyle = '#f3b44990'; c.fillText('THE WORLD IS WATCHING', 0, 155); c.restore();
      c.fillStyle = '#f0b74c'; for (let i = 0; i < 6; i++) { c.fillRect(80 + i * 28, 80, 18, 50); c.fillRect(780 + i * 28, 895, 18, 50); }
    }); this.textures.push(floor);
    const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 10.8), new THREE.MeshBasicMaterial({ map: floor, transparent: true, depthWrite: false })); floorPlane.rotation.x = -Math.PI / 2; floorPlane.position.y = 0.046; this.scene.add(floorPlane);
    for (const x of [-5.1, 5.1]) {
      cube(stage, 0x61e9d0, 0.055, 0.05, 11.7, x, -0.13, 0, 0, true);
      for (const z of [-5.7, 5.7]) {
        cube(stage, 0x273947, 0.4, 2, 0.4, x, 0.7, z, 0.6);
        cube(stage, x < 0 ? 0x61e9d0 : 0xf7bc4b, 0.44, 0.3, 0.44, x, 1.65, z, 0.2, true);
        for (const y of [0.7, 1.2]) { const rail = cylinder(stage, 0x46616c, 0.035, 0.035, 11.4, x, y); rail.rotation.x = Math.PI / 2; }
      }
    }
    for (const z of [-5.7, 5.7]) { cube(stage, 0xf7bc4b, 10.3, 0.05, 0.06, 0, -0.13, z, 0, true); }
    const ledGeometry = new THREE.BoxGeometry(0.09, 0.04, 0.58);
    for (const x of [-4.65, 4.65]) for (let i = 0; i < 8; i++) {
      const panel = new THREE.Mesh(ledGeometry, new THREE.MeshBasicMaterial({ color: x < 0 ? 0x75efdb : 0xffbd62 }));
      panel.position.set(x, 0.08, -4.3 + i * 1.22); this.scene.add(panel); this.ledPanels.push(panel);
    }
    for (let i = 0; i < 3; i++) cube(stage, 0x283945, 2.4 + i * 0.3, 0.18, 0.45, 0, -0.25 - i * 0.18, 6.1 + i * 0.45);
    // Back wall, giant on-air screen and steel lighting rigs.
    cube(stage, 0x101824, 19, 7, 0.6, 0, 2.8, -10.2);
    const screenTex = canvasTexture(1024, 512, c => { c.fillStyle = '#112e34'; c.fillRect(0, 0, 1024, 512); c.fillStyle = '#65eed5'; for (let i = 0; i < 1024; i += 48) c.fillRect(i, 0, 2, 512); c.fillStyle = '#f5c35b'; c.font = '900 italic 135px sans-serif'; c.textAlign = 'center'; c.fillText('PRIME TIME', 512, 215); c.font = '900 92px sans-serif'; c.fillStyle = '#e3e9da'; c.fillText('SHOWDOWN', 512, 320); c.font = 'bold 30px monospace'; c.fillStyle = '#64e4ca'; c.fillText('● LIVE     •     CHANNEL 01', 512, 420); }); this.textures.push(screenTex);
    cube(stage, 0x344a55, 8.8, 4.3, 0.3, 0, 3.1, -9.7, 0.7);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.05), new THREE.MeshBasicMaterial({ map: screenTex })); screen.position.set(0, 3.1, -9.51); this.scene.add(screen);
    this.tickerCanvas.width = 512; this.tickerCanvas.height = 64;
    this.tickerTexture = new THREE.CanvasTexture(this.tickerCanvas); this.tickerTexture.colorSpace = THREE.SRGBColorSpace; this.textures.push(this.tickerTexture);
    const ticker = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 0.8), new THREE.MeshBasicMaterial({ map: this.tickerTexture }));
    ticker.position.set(0, 0.55, -9.35); this.scene.add(ticker);
    for (const x of [-7.5, 7.5]) { cube(stage, 0x31434e, 0.25, 7, 0.25, x, 2.5, -8); for (let i = 0; i < 7; i++) { const bar = cube(stage, 0x31434e, 1.1, 0.07, 0.07, x, i - 0.4, -8); bar.rotation.z = i % 2 ? 0.8 : -0.8; }
      for (const z of [-7, 5]) { cylinder(stage, 0x1b2937, 0.4, 0.5, 0.5, x, 4, z).rotation.x = 0.4; const b = new THREE.Mesh(new THREE.ConeGeometry(2, 7, 16, 1, true), new THREE.MeshBasicMaterial({ color: x < 0 ? 0x60e9dc : 0xf4c36c, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide })); b.position.set(x * 0.65, 3.2, z); b.rotation.z = x < 0 ? -0.6 : 0.6; this.scene.add(b); this.beams.push(b); }
    }
    const crowdGeometry = new THREE.IcosahedronGeometry(0.2, 1); this.crowd = new THREE.InstancedMesh(crowdGeometry, material(0x8ba7b4), 144); const dummy = new THREE.Object3D();
    for (let i = 0; i < 144; i++) { const side = i < 72 ? -1 : 1, row = Math.floor(i % 72 / 18), col = i % 18; dummy.position.set(side * (6.3 + row * 0.55), 0.7 + row * 0.4, -6 + col * 0.65); dummy.scale.set(1, 1.6, 1); dummy.updateMatrix(); this.crowd.setMatrixAt(i, dummy.matrix); this.crowd.setColorAt(i, new THREE.Color([0x477678, 0xa78069, 0x6e597c, 0x808a89][i % 4])); }
    this.scene.add(this.crowd);
    // Soft contact shadows stay readable even with low graphics.
    const shadowTex = canvasTexture(64, 64, c => { const g = c.createRadialGradient(32, 32, 1, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }); this.textures.push(shadowTex);
    for (const f of [this.player, this.enemy]) { const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015; f.root.add(shadow); f.root.scale.setScalar(1.15); this.scene.add(f.root); }
    this.scene.add(this.effects.group);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host); this.resize();
    this.renderer.domElement.dataset.heroModel = 'loading';
    void this.player.loadHero().then(loaded => {
      const canvas = this.renderer.domElement, visual = this.player.heroVisual;
      canvas.dataset.heroModel = loaded ? 'glb' : 'procedural';
      canvas.dataset.heroBones = String(visual?.bones.size ?? 0);
      canvas.dataset.heroAnimations = String(visual?.clips.length ?? 0);
    });
  }
  resize() { const w = this.host.clientWidth, h = this.host.clientHeight; this.renderer.setSize(w, h); const halfWidth = 6.35; this.camera.left = -halfWidth; this.camera.right = halfWidth; this.camera.top = halfWidth * h / w; this.camera.bottom = -this.camera.top; this.camera.updateProjectionMatrix(); }
  setQuality(low: boolean) { this.low = low; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1 : 1.75)); this.key.castShadow = !low; this.effects.quality = low ? 0.5 : 1; this.resize(); }
  setMode(mode: 'lobby' | 'battle', weapon: WeaponId, enemyWeapon?: WeaponId) { this.mode = mode; this.player.setWeapon(weapon); this.enemy.setWeapon(enemyWeapon || 'pistol'); this.enemy.root.visible = mode === 'battle'; this.effects.reset(); this.cheer = 0; this.tickerKey = ''; if (mode === 'lobby') this.player.snapTo(this.lobbyFighter.player); }
  event(e: CombatEvent) { this.effects.event(e); if (e.heavy || e.type === 'combo' || e.type === 'finish' || e.type === 'showtime') this.cheer = 1.5; }
  render(dt: number, match?: Combat, timeScale = 1) {
    this.time += dt * timeScale; this.cheer = Math.max(0, this.cheer - dt); this.effects.update(dt);
    const battle = this.mode === 'battle' && match;
    if (battle) {
      this.player.update(match.player, match.enemy, this.time, match.finished && match.winner === 'player', dt * timeScale);
      this.enemy.update(match.enemy, match.player, this.time, match.finished && match.winner === 'enemy', dt * timeScale);
      [match.player, match.enemy].forEach((f, i) => { const s = this.effects.smokes[i]; s.visible = f.smoke > 0; s.position.set(f.x, 0, f.z); s.rotation.y = this.time * 0.2; });
      this.camera.position.lerp(this.battlePosition, Math.min(1, dt * 4)); this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, match.finished ? 1.35 : 1 + this.effects.punch * 0.18, dt * 8); if (match.finished) { const winner = match.winner === 'enemy' ? match.enemy : match.player; this.viewTarget.lerp(this.targetPoint.set(winner.x, 0.7, winner.z), Math.min(1, dt * 4)); } else this.viewTarget.lerp(this.targetPoint.set(0, 0, 0), Math.min(1, dt * 4)); this.camera.lookAt(this.viewTarget);
    } else {
      const f = this.lobbyFighter.player; f.x = 0; f.z = 0; f.stride = 0; this.lobbyFighter.enemy.x = Math.sin(this.time * 0.25) * 2 + 7; this.lobbyFighter.enemy.z = 14;
      this.player.update(f, this.lobbyFighter.enemy, this.time, false, dt); this.camera.position.lerp(this.lobbyPosition, Math.min(1, dt * 4)); this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, this.preview ? 2.5 : this.host.clientHeight < 650 ? 2.2 : 3.05, dt * 4); this.viewTarget.set(0, 1.1, 0); this.camera.lookAt(this.viewTarget);
    }
    this.camera.updateProjectionMatrix();
    if (this.effects.shake > 0) { this.camera.position.x += (Math.random() - 0.5) * this.effects.shake; this.camera.position.y += (Math.random() - 0.5) * this.effects.shake; }
    this.beams.forEach((b, i) => { b.rotation.z = Math.sin(this.time * 0.4 + i) * 0.6; (b.material as THREE.MeshBasicMaterial).opacity = battle && match.showtime ? 0.105 : 0.055; });
    this.crowd.position.y = Math.abs(Math.sin(this.time * (battle && match.showtime ? 8 : 2))) * (this.cheer > 0 ? 0.22 : battle && match.showtime ? 0.13 : 0.035);
    this.ledPanels.forEach((panel, i) => { const pulse = 0.7 + Math.sin(this.time * (battle && match.showtime ? 7 : 3) - i * 0.7) * 0.3; panel.scale.y = 1 + pulse * 0.5; (panel.material as THREE.MeshBasicMaterial).color.setHex(i < 8 ? (pulse > 0.7 ? 0xa2ffe8 : 0x3eafab) : (pulse > 0.7 ? 0xffd37c : 0xd28c47)); });
    const tickerKey = battle ? match.finished ? 'ЭФИР ЗАВЕРШЁН / THE WORLD IS WATCHING' : match.showtime ? 'SHOWTIME / ENERGY ×1.25 / MAKE IT COUNT' : `LIVE / ROUND 01 / ${Math.ceil(match.remaining)} SECONDS` : 'PRIME TIME / YOUR NEXT BIG MOMENT';
    if (this.tickerKey !== tickerKey) {
      this.tickerKey = tickerKey; const c = this.tickerCanvas.getContext('2d')!;
      c.fillStyle = '#092d33'; c.fillRect(0, 0, 512, 64); c.fillStyle = battle && match.showtime ? '#ffd16c' : '#9affe0';
      c.font = 'bold 21px monospace'; c.textAlign = 'center'; c.fillText(tickerKey, 256, 40); this.tickerTexture.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.low) { this.fpsTime += dt; this.fpsFrames++; if (this.fpsTime > 3) { this.slowWindows = this.fpsFrames / this.fpsTime < 42 ? this.slowWindows + 1 : 0; if (this.slowWindows >= 2) this.setQuality(true); this.fpsTime = 0; this.fpsFrames = 0; } }
  }
  dispose() { this.resizeObserver.disconnect(); this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost); this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored); this.player.dispose(); this.enemy.dispose(); this.effects.dispose(); for (const t of this.textures) t.dispose(); const geometries = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>(); this.scene.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m); } }); geometries.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); disposeShared(); this.renderer.dispose(); }
}
