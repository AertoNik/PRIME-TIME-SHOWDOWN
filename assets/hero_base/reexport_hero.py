"""Export edited hero_base.blend without rebuilding the procedural character.

blender -b hero_base.blend --gpu-backend opengl --python reexport_hero.py
Optional: append -- --output /absolute/path/hero_edited.glb
"""
import argparse
from pathlib import Path
import sys
import bpy

argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
parser=argparse.ArgumentParser()
parser.add_argument('--output',default=str(Path(bpy.data.filepath).with_suffix('.glb')))
args=parser.parse_args(argv)
collection=bpy.data.collections.get('HERO | Rook')
assert collection, 'Open hero_base.blend first; HERO | Rook collection is required.'
rigs=[o for o in collection.all_objects if o.type=='ARMATURE']
assert len(rigs)==1, 'Expected one humanoid armature'
rig=rigs[0]
if bpy.context.object and bpy.context.object.mode!='OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
# Preserve the artist's current pose while exporting the neutral rig.
pose_position=rig.data.pose_position
rig.data.pose_position='REST'
bpy.ops.object.select_all(action='DESELECT')
for obj in collection.all_objects:
    if obj.type in {'MESH','ARMATURE'}:
        obj.hide_set(False)
        obj.select_set(True)
bpy.context.view_layer.objects.active=rig
try:
    bpy.ops.export_scene.gltf(filepath=str(Path(args.output).resolve()),
        export_format='GLB',use_selection=True,export_yup=True,
        export_apply=False,export_animations=False,export_skins=True,
        export_all_influences=False,export_extras=True,export_texcoords=True,
        export_normals=True,export_materials='EXPORT')
finally:
    rig.data.pose_position=pose_position
print('Character exported to '+args.output)
