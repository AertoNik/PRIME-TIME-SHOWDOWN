// Standalone loader check only. Does not import the asset into the game.
// Run from repository: node assets/hero_base/validate_three.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, Vector3 } from 'three';

const path=fileURLToPath(new URL('./hero_base.glb',import.meta.url));
const bytes=fs.readFileSync(path);
const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const gltf=await new GLTFLoader().parseAsync(buffer,'');
gltf.scene.updateMatrixWorld(true);
const skins=[];
gltf.scene.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});
if(!skins.length)throw new Error('No skinned meshes loaded');
const skeletons=new Set(skins.map(o=>o.skeleton));
const jointNames=new Set(skins.flatMap(o=>o.skeleton.bones.map(b=>b.name)));
if(skeletons.size!==1 || jointNames.size!==32)throw new Error('Expected one 32-bone skeleton');
for(const mesh of skins){
  const g=mesh.geometry;
  for(const name of ['position','normal','uv','skinIndex','skinWeight']){
    if(!g.getAttribute(name))throw new Error('Missing '+name+' on '+mesh.name);
  }
  const w=g.getAttribute('skinWeight');
  for(let i=0;i<w.count;i++){
    const total=w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i);
    if(Math.abs(total-1)>.002)throw new Error('Weights not normalized');
  }
}
const bounds=new Box3().setFromObject(gltf.scene);
const size=bounds.getSize(new Vector3());
if(size.y<1.9 || size.y>2.2)throw new Error('Unexpected glTF Y-up scale');
if(Math.abs(bounds.min.y)>1e-5)throw new Error('Soles not grounded at Y=0');
const report={result:'PASS',loader:'Three.js GLTFLoader',skinnedPrimitives:skins.length,
  skeletons:skeletons.size,bones:jointNames.size,animations:gltf.animations.length,
  boundsMin:bounds.min.toArray(),boundsMax:bounds.max.toArray(),sizeMeters:size.toArray()};
fs.writeFileSync(new URL('./three_validation_report.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
