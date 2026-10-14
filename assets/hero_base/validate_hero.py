"""Read the GLB and perform an independent Blender round-trip skinning smoke test.
Run: blender -b --factory-startup --gpu-backend opengl --python validate_hero.py
"""
import bpy
import json
import math
import struct
from pathlib import Path

folder=Path(__file__).resolve().parent
data=(folder/'hero_base.glb').read_bytes()
magic,version,length=struct.unpack_from('<4sII',data)
assert magic==b'glTF' and version==2 and length==len(data)
json_len,json_type=struct.unpack_from('<II',data,12)
assert json_type==0x4E4F534A
doc=json.loads(data[20:20+json_len])
primitives=[p for mesh in doc['meshes'] for p in mesh['primitives']]
assert len(doc['skins'])==1, 'Expected one humanoid skin'
assert all('JOINTS_0' in p['attributes'] and 'WEIGHTS_0' in p['attributes'] for p in primitives)
assert all('NORMAL' in p['attributes'] and 'TEXCOORD_0' in p['attributes'] for p in primitives)
assert not doc.get('animations'), 'Delivery must be a neutral bind pose'
assert all(not b.get('uri') for b in doc['buffers']), 'GLB must be self-contained'
assert not doc.get('cameras'), 'Studio cameras must not be exported'
assert not doc.get('textures'), 'Materials use native PBR values only'
triangle_count=sum(doc['accessors'][p['indices']]['count']//3 for p in primitives)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(folder/'hero_base.glb'))
rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
assert len(rigs)==1
rig=rigs[0]
assert len(rig.data.bones)==32
unweighted=0;bad_weights=0;invalid_bones=[]
for obj in meshes:
    assert any(m.type=='ARMATURE' and m.object==rig for m in obj.modifiers)
    for vg in obj.vertex_groups:
        if vg.name not in rig.data.bones:invalid_bones.append(vg.name)
    for v in obj.data.vertices:
        total=sum(g.weight for g in v.groups)
        unweighted+=int(total==0)
        bad_weights+=int(abs(total-1)>.002)
assert not unweighted and not bad_weights and not invalid_bones

# glTF exporter/importer changes the local joint bases. Apply small local rotations
# simply to prove evaluated vertices move and remain finite after skinning.
def evaluated_coords(obj):
    dep=bpy.context.evaluated_depsgraph_get()
    ev=obj.evaluated_get(dep)
    me=ev.to_mesh()
    co=[obj.matrix_world@v.co for v in me.vertices]
    ev.to_mesh_clear()
    return co

before={o.name:evaluated_coords(o) for o in meshes}
for name,degrees in [('upper_arm.L',15),('forearm.L',35),('thigh.R',12),
                     ('shin.R',20),('head',10),('finger_1.L',15),('thumb.R',15)]:
    pb=rig.pose.bones[name]
    pb.rotation_mode='XYZ'
    pb.rotation_euler.z=math.radians(degrees)
bpy.context.view_layer.update()
moved={}
for obj in meshes:
    after=evaluated_coords(obj)
    assert all(math.isfinite(c) for v in after for c in v)
    moved[obj.name]=sum((a-b).length>1e-5 for a,b in zip(before[obj.name],after))
assert sum(moved.values())>1000
for pb in rig.pose.bones:pb.rotation_euler=(0,0,0)
bpy.context.view_layer.update()
max_rest_error=0
for obj in meshes:
    after=evaluated_coords(obj)
    max_rest_error=max(max_rest_error,max((a-b).length for a,b in zip(before[obj.name],after)))
assert max_rest_error<1e-6

report={'glb_version':version,'glb_bytes':len(data),'triangles':triangle_count,
    'mesh_objects':len(meshes),'material_primitives_draw_calls':len(primitives),
    'materials':len(doc['materials']),'skins':len(doc['skins']),'bones':len(rig.data.bones),
    'self_contained':True,'studio_excluded':True,'normals_and_uvs':True,
    'unweighted_vertices':unweighted,'invalid_weight_sums':bad_weights,
    'pose_smoke_test_moved_vertices':moved,'return_to_rest_max_error_m':max_rest_error,
    'result':'PASS'}
(folder/'validation_report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
