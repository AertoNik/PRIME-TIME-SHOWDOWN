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
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform vec3 uTint;
uniform float uTintAmount;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float rimDot = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
float rimAmt = smoothstep(0.55, 0.9, rimDot) * uRimStrength;
outgoingLight += uRimColor * rimAmt;
outgoingLight = mix(outgoingLight, outgoingLight * 0.55 + uTint * 0.9, uTintAmount);
outgoingLight = mix(outgoingLight, uFlashColor, uFlash);
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'pt-toon-rim';
  return mat;
}

export function toonUniforms(mat: MeshToonMaterial): ToonUniforms {
  return mat.userData.uniforms as ToonUniforms;
}

let outlineMat: MeshBasicMaterial | null = null;

/** Inverted-hull outline pushed along normals in object space. */
export function outlineMaterial(): MeshBasicMaterial {
  if (outlineMat) return outlineMat;
  const mat = new MeshBasicMaterial({ color: 0x0a0b1c, side: BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: 0.024 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutline;');
  };
  mat.customProgramCacheKey = () => 'pt-outline';
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
