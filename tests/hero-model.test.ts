import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { Character } from '../src/characters';
import { Combat } from '../src/combat';
import { HERO_FLOOR, HERO_HEIGHT, HeroVisual, heroModelUrl } from '../src/hero-model';

const bytes = readFileSync(new URL('../public/models/hero_base.glb', import.meta.url));
const parse = () => new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const fighter = () => new Combat('pistol', ['dash', 'power', 'shield', 'shock'], () => 0.5);

describe('imported player visual', () => {
  it('supports relative and Pages base paths', () => {
    expect(heroModelUrl('./')).toBe('./models/hero_base.glb');
    expect(heroModelUrl('/PRIME-TIME-SHOWDOWN/')).toBe('/PRIME-TIME-SHOWDOWN/models/hero_base.glb');
    expect(heroModelUrl('/')).toBe('/models/hero_base.glb');
  });
  it('loads the real GLB, grounds and sizes it, poses bones and attaches a forward-facing gun', async () => {
    const visual = new HeroVisual(await parse());
    expect(visual.bones.size).toBe(32); expect(visual.clips).toEqual([]); expect(visual.mixer).toBeNull();
    expect(visual.handBone).toBe('handR');
    const bounds = new THREE.Box3().setFromObject(visual.root, true);
    expect(bounds.min.y).toBeCloseTo(HERO_FLOOR, 4);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(HERO_HEIGHT, 3);
    const gun = new THREE.Group(); visual.attachWeapon(gun); visual.root.updateMatrixWorld(true);
    expect(gun.parent?.parent).toBe(visual.bones.get('handR'));
    expect(gun.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1, 4);
    expect(gun.getWorldDirection(new THREE.Vector3()).z).toBeCloseTo(1, 4);
    const hand = visual.bones.get('handR')!.getWorldPosition(new THREE.Vector3());
    expect(hand.y).toBeGreaterThan(1); expect(hand.z).toBeGreaterThan(0.3);
    visual.gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { expect(o.castShadow).toBe(true); expect(o.receiveShadow).toBe(true); } });
    visual.dispose();
  });
  it('changes only the player visual and retains all weapons, effects and simulation coordinates', async () => {
    const player = new Character(), enemy = new Character(true), loader = vi.fn(parse);
    const enemyShape = enemy.root.children.slice();
    expect(await enemy.loadHero(loader)).toBe(false); expect(loader).not.toHaveBeenCalled();
    expect(await player.loadHero(loader)).toBe(true); expect(await player.loadHero(loader)).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1); expect(player.body.visible).toBe(false); expect(player.leftLeg.visible).toBe(false);
    expect(enemy.body.visible).toBe(true); expect(enemy.root.children).toEqual(enemyShape);
    const match = fighter(); match.player.x = 2; match.player.z = -1; match.player.shield = 2; match.player.windup = 0.5;
    const state = JSON.stringify(match.player);
    for (const weapon of ['pistol', 'shotgun', 'carbine'] as const) {
      player.setWeapon(weapon); player.snapTo(match.player); player.update(match.player, match.enemy, 1, false);
      expect(player.gun.children.length).toBeGreaterThan(3); expect(player.gun.parent).toBe(player.heroVisual!.weaponSocket);
      expect(player.root.position.x).toBe(2); expect(player.root.position.z).toBe(-1);
      expect(player.shield.visible).toBe(true); expect(player.charge.visible).toBe(true);
      expect(JSON.stringify(match.player)).toBe(state);
    }
    player.dispose(); enemy.dispose();
  });
  it('keeps the existing procedural fighter usable when loading fails', async () => {
    const player = new Character(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await player.loadHero(async () => { throw new Error('404'); })).toBe(false);
      expect(player.heroVisual).toBeNull(); expect(player.body.visible).toBe(true);
      expect(player.gun.parent).toBe(player.rightArm);
      const match = fighter(); player.update(match.player, match.enemy, 1); player.setWeapon('shotgun');
      expect(player.gun.children.length).toBe(5);
    } finally { player.dispose(); warn.mockRestore(); }
  });
  it('releases a pending download after disposal rather than adding it to a dead scene', async () => {
    const player = new Character(), gltf = await parse();
    const geometry = (gltf.scene.getObjectByName('Body') as THREE.Mesh).geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    let complete!: (g: GLTF) => void;
    const loading = player.loadHero(() => new Promise(resolve => { complete = resolve; }));
    player.dispose(); complete(gltf);
    expect(await loading).toBe(false); expect(player.heroVisual).toBeNull(); expect(dispose).toHaveBeenCalledOnce();
  });
  it('uses AnimationMixer when authored clips are present and supports a temporary socket without bones', () => {
    const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
    const clip = new THREE.AnimationClip('Idle', 1, [new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1], [0, 0.1])]);
    const visual = new HeroVisual({ scene, animations: [clip] } as GLTF);
    expect(visual.mixer).toBeInstanceOf(THREE.AnimationMixer); expect(visual.handBone).toBeNull();
    expect(visual.weaponSocket.parent).toBe(visual.root);
    const match = fighter(); visual.update(match.player, 1, false, 0.5);
    expect(scene.rotation.y).toBeCloseTo(0.05); expect(visual.playClip('Missing')).toBe(false);
    visual.reset(); visual.dispose();
  });
});
