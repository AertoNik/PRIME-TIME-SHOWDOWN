import {
  AdditiveBlending,
  BackSide,
  Color,
  DataTexture,
  DoubleSide,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  type Texture,
} from 'three';

let gradient: DataTexture | null = null;

/** 3-band toon ramp: crisp cel shading that still reads soft on mobile. */
export function toonRamp(): DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([92, 168, 230, 255]);
  gradient = new DataTexture(data, data.length, 1, RedFormat);
  gradient.minFilter = NearestFilter;
  gradient.magFilter = NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export interface ToonUniforms {
  uRimColor: { value: Color };
  uRimStrength: { value: number };
  uFlash: { value: number };
  uFlashColor: { value: Color };
  uTint: { value: Color };
  uTintAmount: { value: number };
}

/**
 * Beta 2.3 — material classes of a fighter's surfaces. One toon material still draws the whole fighter (no extra draw
 * call, no extra texture): the class is a per-vertex attribute (`ptMat`, written by FighterModel's PartSet) and the
 * shader below treats each class its own way —
 *   cloth  the crisp three-band cel shading, as before;
 *   skin   the same bands with soft edges and a warm terminator (no hard stripe across a face);
 *   metal  a sky-to-ground gradient and a tight bright highlight (weapons, buckles, the robot's shell);
 *   gloss  a softer highlight (boots, gloves, lacquered parts);
 *   hair   a soft band of light in the hair's own colour.
 * A geometry without the attribute reads 0 everywhere — cloth, exactly the earlier look.
 */
export const MAT = { cloth: 0, skin: 1, metal: 2, gloss: 3, hair: 4 } as const;
export type MatClass = (typeof MAT)[keyof typeof MAT];

/** Toon material with fresnel rim light, hit flash and status tint uniforms. */
export function makeToonMaterial(rim: number | Color, rimStrength = 0.55): MeshToonMaterial {
  const mat = new MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
  const uniforms: ToonUniforms = {
    uRimColor: { value: new Color(rim) },
    uRimStrength: { value: rimStrength },
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 1, 1) },
    uTint: { value: new Color(1, 0.4, 0.1) },
    uTintAmount: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Beta 2.3: the material class travels from the vertex to the fragment (flat per part: every part has one class)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ptMat;\nvarying float vPtMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPtMat = ptMat;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform vec3 uTint;
uniform float uTintAmount;
varying float vPtMat;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 ptV = normalize(vViewPosition);
// Beta 2.3 — material classes (see MAT): 1 skin, 2 metal, 3 gloss, 4 hair; 0 cloth keeps the plain cel shading
float ptSkin = step(0.5, vPtMat) * step(vPtMat, 1.5);
float ptMetal = step(1.5, vPtMat) * step(vPtMat, 2.5);
float ptGloss = step(2.5, vPtMat) * step(vPtMat, 3.5);
float ptHair = step(3.5, vPtMat) * step(vPtMat, 4.5);
#if NUM_DIR_LIGHTS > 0
  // (the key light is the scene's first directional light — Renderer.ts, PortraitStudio.ts)
  vec3 ptL = directionalLights[0].direction;
#else
  vec3 ptL = vec3(0.0, 1.0, 0.0);
#endif
float ptD = dot(normal, ptL);
// skin: every directional light's toon step (toonRamp: 0.36 / 0.66 / 0.90 / 1.0 at −0.5 / 0 / +0.5) is swapped for the
// same ramp with soft edges — exactly the difference, light by light (Opus: the fill lights too, and never the ambient),
// so a face has no hard stripe and no polygon-shaped band edges on its sphere
#if NUM_DIR_LIGHTS > 0
  vec3 ptSkinFix = vec3(0.0);
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3 ptLi = directionalLights[i].direction;
    float ptDi = dot(normal, ptLi);
    float ptSoftI = mix(0.361, 0.659, smoothstep(-0.66, -0.34, ptDi));
    ptSoftI = mix(ptSoftI, 0.902, smoothstep(-0.17, 0.17, ptDi));
    ptSoftI = mix(ptSoftI, 1.0, smoothstep(0.34, 0.66, ptDi));
    ptSkinFix += directionalLights[i].color * (ptSoftI - getGradientIrradiance(normal, ptLi).r);
  }
  outgoingLight += ptSkinFix * BRDF_Lambert(diffuseColor.rgb) * ptSkin;
#endif
// near-black cloth (Lucien's tailcoat, Vale's uniform, the black suits): the darkest bands crushed it to flat black, so
// only the rims and trims drew lines on it — read as dark creases. A cool lift that follows the form (more on the lit
// side) keeps the folds as shape (Opus)
float ptLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float ptDark = 1.0 - smoothstep(0.004, 0.05, ptLuma);
outgoingLight += vec3(0.022, 0.024, 0.034) * ptDark * (1.0 - ptSkin) * (1.0 - ptMetal) * (0.35 + 0.65 * smoothstep(-0.45, 0.65, ptD));
// …and a little warmth where the light turns into shadow
outgoingLight += diffuseColor.rgb * vec3(0.16, 0.035, 0.01) * ptSkin * (1.0 - smoothstep(0.0, 0.38, abs(ptD + 0.04)));
// metal / gloss / hair: a highlight toward the key light, metal with a sky-to-ground gradient under it
float ptNH = max(dot(normal, normalize(ptL + ptV)), 0.0);
outgoingLight *= mix(1.0, 0.74 + 0.42 * smoothstep(-0.35, 0.85, normal.y), ptMetal);
float ptSpec = (smoothstep(0.935, 0.975, ptNH) * 0.8 + smoothstep(0.62, 1.0, ptNH) * 0.1) * ptMetal + smoothstep(0.9, 0.985, ptNH) * 0.34 * ptGloss;
outgoingLight += vec3(1.0, 0.98, 0.94) * ptSpec + diffuseColor.rgb * (smoothstep(0.8, 0.95, ptNH) * 0.3 * ptHair);
float rimDot = 1.0 - max(dot(normal, ptV), 0.0);
float rimAmt = smoothstep(0.55, 0.9, rimDot) * uRimStrength;
outgoingLight += uRimColor * rimAmt;
outgoingLight = mix(outgoingLight, outgoingLight * 0.55 + uTint * 0.9, uTintAmount);
outgoingLight = mix(outgoingLight, uFlashColor, uFlash);
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'pt-toon-23d';
  return mat;
}

export function toonUniforms(mat: MeshToonMaterial): ToonUniforms {
  return mat.userData.uniforms as ToonUniforms;
}

let outlineMat: MeshBasicMaterial | null = null;

/**
 * Inverted-hull outline pushed along normals in object space. Beta 2.3: a small detail (a buckle, a stripe, a finger)
 * wears a thinner line than the silhouette — `ptThin` (0…1, per vertex, written by FighterModel's PartSet from the
 * part's size) takes that share off the width; a geometry without the attribute reads 0: the full line, as before.
 */
export function outlineMaterial(): MeshBasicMaterial {
  if (outlineMat) return outlineMat;
  const mat = new MeshBasicMaterial({ color: 0x0a0b1c, side: BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: 0.024 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;\nattribute float ptThin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutline * (1.0 - ptThin);');
  };
  mat.customProgramCacheKey = () => 'pt-outline-23';
  outlineMat = mat;
  return mat;
}

/** Unlit vertex-coloured material (eyes, glows). Values > 1 bloom. */
export function makeUnlitVC(intensity = 1): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ vertexColors: true });
  m.color.setScalar(intensity);
  return m;
}

/** Hologram decoy material: additive fresnel with scanlines. */
export function makeHoloMaterial(color: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vY = wp.y;
        vec4 mv = viewMatrix * wp;
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        f = pow(f, 1.4);
        float scan = 0.55 + 0.45 * sin(vY * 38.0 - uTime * 9.0);
        float flick = 0.85 + 0.15 * sin(uTime * 47.0);
        vec3 c = uColor * (0.18 + f * 1.8) * scan * flick * uOpacity;
        gl_FragColor = vec4(c, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/** Simple additive material for glowing VFX meshes. */
export function additive(color: number | Color, opacity = 1, map?: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    map: map ?? null,
  });
}
