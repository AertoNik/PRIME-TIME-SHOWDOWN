import { expect, it } from 'vitest';
import { Effects } from '../src/effects';
it('reuses the same effect pools across repeated duels and clears all transient effects', () => {
  const effects = new Effects(), count = effects.group.children.length;
  for (let match = 0; match < 8; match++) {
    for (let shot = 0; shot < 50; shot++) {
      effects.event({ type:'shot', side:'player', x:-1, z:1, tx:1, tz:-1, weapon:'carbine', heavy:shot % 7 === 0, hit:true });
      effects.event({ type:'hit', side:'enemy', x:1, z:-1, heavy:shot % 7 === 0, damage:45 });
      effects.update(1/60);
    }
    effects.smokes[0].visible = true; effects.reset();
    expect(effects.group.children.length).toBe(count);
    expect(effects.shake).toBe(0); expect(effects.punch).toBe(0);
    for (const child of effects.group.children) if ('isMesh' in child || child === effects.smokes[0] || child === effects.smokes[1]) expect(child.visible).toBe(false);
  }
  effects.dispose();
});
