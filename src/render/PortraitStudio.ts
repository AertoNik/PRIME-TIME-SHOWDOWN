import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { defaultInput } from './FighterAnimator';
import type { ModelCache } from './ModelCache';
import type { Renderer } from './Renderer';

/**
 * Renders head-and-shoulders portraits of each fighter with the main WebGL
 * context and copies them into PNG data URLs for the HTML UI.
 * Alpha 1.8.8: `bust` frames a little wider (hair and upper body) for the PRIME SHOP cards.
 */
export function renderPortraits(r: Renderer, models: ModelCache, looks: string[], bust = false): Record<string, string> {
  const out: Record<string, string> = {};
  const gl = r.renderer;
  const canvas = gl.domElement;
  const size = Math.min(256, canvas.width, canvas.height);
  if (size < 64) return out;
  const pr = gl.getPixelRatio();
  const css = size / pr;

  const scene = new Scene();
  scene.add(new HemisphereLight(0xb0c4ff, 0x40205a, 1.6));
  const key = new DirectionalLight(0xfff2e0, 2.6);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const rim = new DirectionalLight(0x7af0ff, 2.2);
  rim.position.set(3, 2, -3);
  scene.add(rim);
  const cam = new PerspectiveCamera(26, 1, 0.1, 30);

  const c2 = document.createElement('canvas');
  c2.width = c2.height = size;
  const ctx = c2.getContext('2d')!;

  const prevClear = new Color();
  gl.getClearColor(prevClear);
  const prevAlpha = gl.getClearAlpha();
  const prevAutoClear = gl.autoClear;
  const shadowsWere = gl.shadowMap.enabled;
  gl.shadowMap.enabled = false;

  for (const look of looks) {
    const m = models.get(look);
    const rig = m.rig;
    const parent = rig.root.parent;
    const prevPos = rig.root.position.clone();
    const prevVis = rig.root.visible;
    scene.add(rig.root);
    rig.root.visible = true;
    m.anim.reset(0.4);
    const inp = defaultInput();
    inp.facing = 0.4;
    for (let i = 0; i < 4; i++) m.anim.update(0.016, inp);
    rig.root.position.set(0, 0, 0);
    rig.root.updateMatrixWorld(true);
    const d = rig.dims;
    const headY = d.hipY + d.spineY + d.neckY + d.headR * 0.75;
    if (bust) {
      cam.position.set(0.5, headY + 0.15, 3.9);
      cam.lookAt(0, headY - 0.14, 0);
    } else {
      cam.position.set(0.35, headY + 0.05, 2.35);
      cam.lookAt(0, headY - 0.18, 0);
    }
    cam.updateProjectionMatrix();

    gl.setRenderTarget(null);
    gl.setScissorTest(true);
    gl.setViewport(0, 0, css, css);
    gl.setScissor(0, 0, css, css);
    gl.setClearColor(0x000000, 0);
    gl.autoClear = false;
    gl.clear(true, true, true);
    gl.render(scene, cam);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(canvas, 0, canvas.height - size, size, size, 0, 0, size, size);
    out[look] = c2.toDataURL('image/png');

    scene.remove(rig.root);
    if (parent) parent.add(rig.root);
    rig.root.position.copy(prevPos);
    rig.root.visible = prevVis;
  }

  gl.setScissorTest(false);
  gl.setViewport(0, 0, canvas.width / pr, canvas.height / pr);
  gl.setClearColor(prevClear, prevAlpha);
  gl.autoClear = prevAutoClear;
  gl.shadowMap.enabled = shadowsWere;
  return out;
}
