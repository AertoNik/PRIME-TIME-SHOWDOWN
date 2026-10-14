# ROOK — PRIME TIME: SHOWDOWN

Original stylized street-arena fighter, built in Blender 3.6.23 with `bpy`.
This folder is a standalone character asset. It does not change the game or its asset loading.

## Deliverables

- `hero_base.blend` — editable character, T-pose deformation rig, materials, UVs, preview cameras and lighting.
- `hero_base.glb` — self-contained character and skeleton only. No studio, cameras, lighting, or animations.
- `create_hero.py` — complete reproducible construction, weighting, export, and rendering script.
- `previews/hero_perspective.png`, `hero_front.png`, `hero_side.png`, `hero_back.png` — 1200 × 1200 renders.
- `reexport_hero.py` — export artist edits from the saved Blender file without rebuilding it.
- `validate_hero.py`, `validate_three.mjs` — repeatable Blender and Three.js loader checks.
- JSON reports — geometry statistics, Blender round-trip checks, and Three.js loader checks.

## Design

Rook has an oversized sculpted head, short swept dark hair, a closed asymmetric smirk, warm skin, a cropped ivory bomber over a navy shirt, fingerless gloves, fitted navy pants, and layered chunky sneakers. Cyan stitching and an original rising-bar shirt emblem give the outfit a consistent arena identity. No existing game character or reference asset was used.

## Open and inspect

Open `hero_base.blend` in Blender using **File → Open**. The character is in **HERO | Rook**; the separate **STUDIO** collection contains render helpers and is hidden in the viewport. Studio helpers are excluded from the GLB.

Select **HeroRig**, switch to **Pose Mode**, and rotate bones to inspect skinning. Clear pose transforms with **Alt-G**, **Alt-R**, and **Alt-S**. The delivered bind pose is a neutral T-pose; no animation clips are included. Render with **F12**; choose another **Preview** camera in Scene Properties for other views.

The rig uses standard linear skinning, 32 bones, authored normalized weights, named left/right limbs, clavicles, feet/toes, thumbs, and one bone per other finger. It is a deformation skeleton without IK controls or a facial rig.

## Regenerate

From Terminal, change to this folder, then run:

```sh
cd "/Users/user/Desktop/PRIME TIME SHOWDOWN/assets/hero_base"
"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --gpu-backend opengl --python create_hero.py
```

The script recreates the entire scene and overwrites generated `.blend`, `.glb`, previews, and `asset_report.json` in its output directory. Save manual edits under another name before rebuilding. No external images, libraries, or add-ons are needed beyond Blender's bundled glTF exporter.

Useful options after `--`:

```sh
# Build into a different folder and omit rendering:
"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --gpu-backend opengl --python create_hero.py -- --output-dir /tmp/rook-rebuild --skip-renders

# Change render resolution or approximate surface budget:
"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --gpu-backend opengl --python create_hero.py -- --render-size 1200 --triangle-budget 32000
```

The eye lenses are exempt from mesh simplification, so the final triangle count is slightly above the requested approximate budget. OpenGL avoids a Metal initialization crash observed with this machine's installed Blender. Rendering uses CPU Cycles, 48 samples, and denoising. Blender 3.6.23 is the verified version; later versions may require small API adjustments.

## Export after editing

Save your Blender edits, then run:

```sh
"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --gpu-backend opengl hero_base.blend --python reexport_hero.py
```

Append `-- --output /absolute/path/hero_edited.glb` to choose another output. This exports the neutral rig and only meshes/armature in the HERO collection.

For a manual export, switch the rig to its rest pose, select the armature and all HERO meshes, then **File → Export → glTF 2.0**. Choose **GLB**, **Selected Objects**, **+Y Up**, **Skinning**, **Normals**, **UVs**, and **Materials**; disable animations and keep **Apply Modifiers** off so the armature remains a skin rather than a baked pose.

## Coordinates and parts

The character root is at world origin and the soles are grounded at Z=0. Scale is in meters; height including hair is approximately 2.019 m. Blender uses Z up and front −Y; the GLB conversion uses Y up and front +Z. Mesh object scales and rotations are identity.

The 13 mesh objects are **Body, Head, Face, Eyes, Hair, Shirt, Jacket, Pants, Hands, Gloves.L, Gloves.R, Shoes.L, Shoes.R**. Each is skinned to HeroRig. Clothing and hair can be replaced independently; the underlying body core is intentionally narrower than the clothes to avoid visible intersections. Decorative pieces remain disconnected surfaces within their corresponding mesh part.

Final geometry: **33,197 triangles**, **17,147 Blender vertices**, **20 PBR materials**. glTF duplicates some vertices at material, UV, and normal boundaries. Materials use base color, roughness, and limited metallic values, with no texture dependencies. UVs are a smart-projected starting point for later painting.

## Verification and remaining refinement

Blender validation checks the GLB container, one skin, bones, normals/UVs, normalized weights, studio exclusion, independent reimport, several posed joints, finite evaluated vertices, and return to the neutral pose. Three.js validation parses the actual file with GLTFLoader and checks the shared skeleton, skin attributes, orientation, scale, and ground contact. These are asset checks; no game integration or on-device performance test was performed.

Repeat Blender checks with the same background flags and `--python validate_hero.py`. From the repository, run `node assets/hero_base/validate_three.mjs` with its installed Three.js dependency.

This is a procedural stylized base, not a final hand-retopologized production character. The most useful manual refinements before full animation production are:

- Refine eyelids, hair planes, jaw, and clothing folds to push the character's personality and polish. Eyes, eyebrows, and mouth currently follow the head rigidly; add facial blend shapes for acting.
- Rebuild deliberate edge loops at shoulder/hip joins, elbows, knees, and finger roots. Several shells overlap; they are not a single watertight body or continuous garment topology. Test the intended combat motions and refine weights/corrective shapes, especially at extreme bends. The included pose check verifies working skinning, not all animation quality.
- Add an animator control rig and extra finger joints if detailed hand animation is required. The current toe joints are available for future weighting; sneakers presently move rigidly with the feet.
- Atlas materials and author UVs for production, then create lower LODs. The GLB has 44 material primitives, which can mean about 44 draw calls per visible character before shadows or additional passes. The triangle count is moderate for a hero, but multiple fighters on lower-end phones warrant further optimization and device profiling.
- For radically different outfits, reshape the hidden body core and review clothing intersections. No cloth simulation, collision meshes, physics bodies, or gameplay sockets are included.
