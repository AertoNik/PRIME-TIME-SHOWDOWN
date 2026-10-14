"""PRIME TIME: SHOWDOWN — ROOK, original procedural character.

Blender 3.6+:
  blender --background --python create_hero.py -- --output-dir ./output
  blender --background --python create_hero.py -- --output-dir ./output --skip-renders

No downloads, add-ons, external textures, or random seeds required.
Coordinates: meters, Z up, face toward -Y, floor Z=0. GLB uses glTF Y up.
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', default=str(Path(__file__).resolve().parent))
parser.add_argument('--skip-renders', action='store_true')
parser.add_argument('--render-size', type=int, default=1200)
parser.add_argument('--triangle-budget', type=int, default=32000)
args = parser.parse_args(ARGS)
OUT = Path(args.output_dir).resolve()
(OUT / 'previews').mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
hero_col = bpy.data.collections.new('HERO | Rook')
scene.collection.children.link(hero_col)
studio_col = bpy.data.collections.new('STUDIO | preview only — excluded from GLB')
scene.collection.children.link(studio_col)
PARTS = {}


def material(name, color, roughness=.5, metallic=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    return m


MAT = {
    'skin': material('01 | warm terracotta skin', (.56, .285, .16), .55),
    'skin_hi': material('02 | nose and ear warmth', (.61, .30, .185), .55),
    'ear': material('03 | ear recess', (.31, .105, .073), .65),
    'hair': material('04 | midnight hair', (.014, .020, .029), .48),
    'hair_hi': material('05 | hair sculpt planes', (.023, .034, .047), .50),
    'ivory': material('06 | warm ivory technical fabric', (.76, .79, .72), .68),
    'navy': material('07 | deep marine fabric', (.024, .055, .095), .68),
    'rib': material('08 | ink ribbing', (.014, .029, .045), .8),
    'pants': material('09 | slate navy twill', (.046, .075, .102), .78),
    'cyan': material('10 | electric cyan woven trim', (.018, .62, .72), .4),
    'cyan_dark': material('11 | muted teal seams', (.025, .28, .34), .6),
    'sole': material('12 | bone rubber', (.69, .72, .66), .8),
    'shoe': material('13 | navy sneaker leather', (.028, .049, .069), .42),
    'metal': material('14 | brushed gunmetal hardware', (.18, .23, .24), .29, .65),
    'white': material('15 | eye white', (.94, .93, .84), .32),
    'iris': material('16 | hazel iris', (.15, .25, .20), .34),
    'pupil': material('17 | pupil and brow', (.009, .013, .018), .35),
    'mouth': material('18 | mouth crease', (.16, .047, .032), .7),
    'lip': material('19 | subtle lower lip', (.43, .18, .105), .65),
    'orange': material('20 | amber zipper pull', (.94, .28, .055), .45),
}


def move_to(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def mesh_obj(name, vertices, faces, mat, part, weight=None, sub=0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    hero_col.objects.link(obj)
    obj.data.materials.append(MAT[mat])
    for p in mesh.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    # Recalculate winding for lofts including mirrored limb shells.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    if sub:
        mod = obj.modifiers.new('Baked surface refinement', 'SUBSURF')
        mod.levels = sub
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if weight:
        apply_weights(obj, weight)
    obj.select_set(False)
    PARTS.setdefault(part, []).append(obj)
    return obj


def apply_weights(obj, fn):
    for v in obj.data.vertices:
        values = fn(v.co) if callable(fn) else {fn: 1.0}
        for bone, w in values.items():
            if w > .00001:
                group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
                group.add([v.index], w, 'REPLACE')


def blend(a, b, t):
    t = max(0, min(1, t))
    t = t*t*(3-2*t)
    return {a: 1-t, b: t}


def trunk(v):
    if v.z < .91:
        return blend('pelvis', 'spine', (v.z-.78)/.13)
    if v.z < 1.16:
        return blend('spine', 'chest', (v.z-.97)/.16)
    return {'chest': 1}


def arm(side):
    def weights(v):
        x = abs(v.x)
        if x < .34:
            return blend('chest', 'upper_arm.'+side, (x-.23)/.11)
        if x < .70:
            return blend('upper_arm.'+side, 'forearm.'+side, (x-.52)/.14)
        return blend('forearm.'+side, 'hand.'+side, (x-.80)/.09)
    return weights


def leg(side):
    def weights(v):
        if v.z > .73:
            return blend('thigh.'+side, 'pelvis', (v.z-.73)/.12)
        if v.z > .31:
            return blend('shin.'+side, 'thigh.'+side, (v.z-.36)/.15)
        return {'shin.'+side: 1}
    return weights


def sgnpow(x, e):
    return math.copysign(abs(x)**e, x)


def zloft(name, rings, mat, part, weight, n=24, exponent=1.0, sub=1):
    # rings: z, center x, center y, radius x, radius y
    verts, faces = [], []
    for z, x, y, rx, ry in rings:
        for i in range(n):
            a = 2*math.pi*i/n
            verts.append((x+rx*sgnpow(math.cos(a), exponent),
                          y+ry*sgnpow(math.sin(a), exponent), z))
    for j in range(len(rings)-1):
        for i in range(n):
            a=j*n+i; b=j*n+(i+1)%n
            faces.append((a,b,b+n,a+n))
    faces.append(tuple(reversed(range(n))))
    faces.append(tuple((len(rings)-1)*n+i for i in range(n)))
    return mesh_obj(name, verts, faces, mat, part, weight, sub)


def xloft(name, rings, sign, mat, part, weight, n=16, sub=1):
    # rings: positive x, center y, center z, y radius, z radius
    verts, faces = [], []
    for x,y,z,ry,rz in rings:
        for i in range(n):
            a=2*math.pi*i/n
            verts.append((sign*x, y+ry*math.cos(a), z+rz*math.sin(a)))
    for j in range(len(rings)-1):
        for i in range(n):
            a=j*n+i; b=j*n+(i+1)%n
            faces.append((a,b,b+n,a+n))
    faces += [tuple(reversed(range(n))), tuple((len(rings)-1)*n+i for i in range(n))]
    return mesh_obj(name, verts, faces, mat, part, weight, sub)


def ellipsoid(name, center, scale, mat, part, weight, seg=24, rings=16, rotation=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=center)
    obj=bpy.context.object
    obj.name=name
    obj.scale=scale
    if rotation:
        obj.rotation_euler=rotation
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    move_to(obj, hero_col)
    obj.data.materials.append(MAT[mat])
    for p in obj.data.polygons:
        p.use_smooth=True
    apply_weights(obj,weight)
    obj.select_set(False)
    PARTS.setdefault(part,[]).append(obj)
    return obj


def tube(name, points, radius, mat, part, weight, resolution=2, closed=False):
    curve=bpy.data.curves.new(name,'CURVE')
    curve.dimensions='3D'
    curve.resolution_u=3
    curve.bevel_depth=radius
    curve.bevel_resolution=min(resolution, 1)
    sp=curve.splines.new('BEZIER')
    sp.bezier_points.add(len(points)-1)
    for p,co in zip(sp.bezier_points,points):
        p.co=co
        p.handle_left_type='AUTO'
        p.handle_right_type='AUTO'
    sp.use_cyclic_u=closed
    obj=bpy.data.objects.new(name,curve)
    hero_col.objects.link(obj)
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.data.materials.append(MAT[mat])
    for p in obj.data.polygons:
        p.use_smooth=True
    apply_weights(obj,weight)
    PARTS.setdefault(part,[]).append(obj)
    obj.select_set(False)
    return obj


def patch(name, outline, mat, part, weight, thickness=.006, bevel=.006):
    obj=mesh_obj(name,outline,[tuple(range(len(outline)))],mat,part,None)
    bpy.context.view_layer.objects.active=obj
    if thickness:
        mod=obj.modifiers.new('Panel thickness','SOLIDIFY'); mod.thickness=thickness
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if bevel:
        mod=obj.modifiers.new('Soft panel edges','BEVEL'); mod.width=bevel; mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    apply_weights(obj,weight)
    return obj


print('STEP 1 — proportions and body',flush=True)
# A tapered body core hidden under independent removable clothing.
zloft('Body | torso',[(.76,0,0,.16,.10),(.79,0,0,.18,.11),(.90,0,0,.18,.112),
    (1.04,0,0,.21,.125),(1.20,0,.005,.25,.136),(1.28,0,.01,.23,.115),
    (1.33,0,.01,.17,.105)],'skin','Body',trunk)
zloft('Body | neck',[(1.27,0,.015,.105,.095),(1.30,0,.015,.106,.094),
    (1.41,0,.018,.105,.09),(1.46,0,.018,.12,.10)],'skin','Body',
    lambda v:blend('chest','neck',(v.z-1.31)/.06))
for side,sign in [('L',1),('R',-1)]:
    xloft('Body | arm '+side,[(.23,0,1.245,.10,.103),(.29,0,1.245,.10,.103),
        (.43,0,1.245,.084,.088),(.56,0,1.245,.075,.077),(.61,0,1.245,.072,.075),
        (.73,0,1.245,.067,.068),(.84,0,1.245,.054,.052),(.88,0,1.245,.053,.05)],
        sign,'skin','Body',arm(side))
    zloft('Body | leg '+side,[(.14,sign*.142,.019,.049,.050),(.17,sign*.142,.019,.050,.051),
        (.40,sign*.151,.016,.064,.060),(.46,sign*.150,.013,.069,.065),
        (.66,sign*.128,.010,.081,.079),(.80,sign*.112,0,.083,.090),
        (.83,sign*.108,0,.075,.086)],'skin','Body',leg(side),n=16)


print('STEP 2 — sculpted head and expression',flush=True)
zloft('Head | tapered cheek and jaw sculpt',[
    (1.37,0,-.008,.09,.095),(1.39,0,-.025,.14,.131),
    (1.43,0,-.015,.195,.166),(1.49,0,0,.235,.188),
    (1.56,0,.004,.268,.207),(1.65,0,.008,.276,.213),
    (1.74,0,.014,.27,.218),(1.83,0,.024,.255,.209),
    (1.90,0,.028,.213,.181),(1.945,0,.026,.13,.13),
    (1.96,0,.024,.045,.06)],'skin','Head','head',n=32,exponent=.86,sub=2)

# Eye design uses an asymmetric, narrowed upper edge for adult confidence.
for side,sign in [('L',1),('R',-1)]:
    ellipsoid('Ear '+side,(sign*.270,.012,1.595),(.061,.043,.088),'skin_hi','Head','head')
    ellipsoid('Ear concha '+side,(sign*.291,-.025,1.598),(.028,.013,.047),'ear','Face','head',seg=16,rings=10)
    tube('Ear inner fold '+side,[(sign*.29,-.04,1.572),(sign*.306,-.039,1.606),
        (sign*.285,-.037,1.63)],.008,'skin_hi','Face','head')
    # Rounded almond patch, a slightly inset-looking dark rim, then ivory eye.
    pts=[(.051,1.654),(.076,1.678),(.126,1.680),(.178,1.674),
         (.197,1.654),(.173,1.630),(.119,1.626),(.075,1.634)]
    outer=[(sign*x,-.215+(.028*(x/.22)**2),z) for x,z in pts]
    # Fill via a curved center fan, subdivided once to make lens-shaped eyes.
    center=(sign*.125,-.220,1.653)
    verts=outer+[center]
    faces=[(i,(i+1)%8,8) for i in range(8)]
    mesh_obj('Eye white '+side,verts,faces,'white','Eyes','head',sub=2)
    tube('Upper lid '+side,[outer[i] for i in [0,1,2,3,4]],.008,'skin_hi','Face','head')
    tube('Lower lid '+side,[outer[i] for i in [4,5,6,7,0]],.005,'skin_hi','Face','head')
    ellipsoid('Iris '+side,(sign*.115,-.220,1.651),(.027,.008,.028),'iris','Eyes','head',seg=20,rings=12)
    ellipsoid('Pupil '+side,(sign*.115,-.227,1.652),(.014,.004,.021),'pupil','Eyes','head',seg=16,rings=12)
    ellipsoid('Eye catchlight '+side,(sign*.108,-.232,1.662),(.006,.002,.007),'white','Eyes','head',seg=12,rings=8)
    # Heavy tapered brows: center dips, outer corner lifts.
    brow=[(sign*.042,-.224,1.705),(sign*.070,-.224,1.734),
          (sign*.144,-.208,1.749),(sign*.200,-.188,1.738),
          (sign*.184,-.194,1.719),(sign*.117,-.215,1.722)]
    patch('Brow '+side,brow,'hair','Face','head',.016,.008)

# Small bridge, a broad sculpted tip, and restrained nostrils.
zloft('Nose | sculpt',[(1.542,0,-.215,.030,.018),(1.548,0,-.229,.044,.028),
    (1.566,0,-.235,.049,.032),(1.589,0,-.229,.037,.033),
    (1.625,0,-.213,.024,.028),(1.681,0,-.195,.026,.020)],
    'skin_hi','Head','head',n=16,sub=2)
for sign in [-1,1]:
    ellipsoid('Nostril',(sign*.029,-.251,1.548),(.010,.004,.004),'ear','Face','head',seg=12,rings=8)
tube('Closed confident smirk',[(-.092,-.174,1.487),(-.046,-.189,1.478),
    (.008,-.195,1.478),(.064,-.189,1.488),(.098,-.175,1.504)],.004,'mouth','Face','head')
tube('Lower lip sculpt',[(-.045,-.181,1.464),(.008,-.187,1.460),(.058,-.180,1.471)],
    .0045,'lip','Face','head')
tube('Smile corner',[(.092,-.177,1.494),(.101,-.174,1.505),(.096,-.174,1.513)],.003,'ear','Face','head')


print('STEP 3 — short swept hair',flush=True)
# Continuous scalp shell with an angled hairline, plus integrated sculpted locks.
verts=[]; faces=[]; N=40
hair_profile=[(1.49,.243,.197),(1.56,.276,.216),(1.65,.284,.222),
    (1.76,.280,.227),(1.85,.263,.223),(1.92,.225,.198),
    (1.97,.150,.155),(2.005,.038,.040),(2.010,0,0)]
def hair_radii(z):
    for (za,xa,ya),(zb,xb,yb) in zip(hair_profile,hair_profile[1:]):
        if za<=z<=zb:
            t=(z-za)/(zb-za)
            return xa*(1-t)+xb*t,ya*(1-t)+yb*t
    return 0,0
for row in range(12):
    t=row/11
    for i in range(N):
        a=2*math.pi*i/N
        front=max(0,-math.sin(a))
        hairline=1.565 + .23*front + .018*math.cos(a)
        z=hairline+(2.010-hairline)*t
        rx,ry=hair_radii(z)
        x=rx*sgnpow(math.cos(a),.88)
        y=.022+ry*sgnpow(math.sin(a),.92)
        verts.append((x,y,z))
for j in range(11):
    for i in range(N):
        a=j*N+i;b=j*N+(i+1)%N
        faces.append((a,b,b+N,a+N))
faces.append(tuple(11*N+i for i in range(N)))
mesh_obj('Hair | continuous tapered scalp',verts,faces,'hair','Hair','head',sub=1)


def lock(name, points, widths, depths, mat='hair'):
    vs=[]; fs=[]; n=10
    for j,p in enumerate(points):
        p=Vector(p)
        direction=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])
        direction.normalize()
        u=Vector((0,1,0)).cross(direction).normalized()
        v=direction.cross(u).normalized()
        for k in range(n):
            a=2*math.pi*k/n
            vs.append(p + u*math.cos(a)*widths[j] + v*math.sin(a)*depths[j])
    for j in range(len(points)-1):
        for k in range(n):
            a=j*n+k;b=j*n+(k+1)%n;fs.append((a,b,b+n,a+n))
    fs.extend([tuple(reversed(range(n))),tuple((len(points)-1)*n+k for k in range(n))])
    mesh_obj(name,vs,fs,mat,'Hair','head',sub=1)


for i in range(5):
    x=-.19+i*.080
    lock('Hair | swept front lock %02d'%i,[(x-.020,-.135,1.813-i*.008),
        (x+.006,-.195,1.868-i*.006),(x+.049,-.165,1.966-i*.006),
        (x+.067,-.038,2.018-i*.008),(x+.031,.088,1.965)],
        [.035,.055,.063,.054,.005],[.016,.026,.029,.025,.005],
        'hair_hi' if i==3 else 'hair')
for sign in [-1,1]:
    lock('Hair | temple taper',[(sign*.248,-.018,1.66),(sign*.266,-.005,1.745),
        (sign*.241,.030,1.83)], [.012,.029,.025],[.013,.032,.015])
    for i in range(3):
        points=[]
        for j in range(5):
            z=1.745+j*.050
            a=-.48+i*.42+j*.10
            rx,ry=hair_radii(z)
            points.append((sign*(rx+.002)*sgnpow(math.cos(a),.88),
                .022+(ry+.002)*sgnpow(math.sin(a),.92),z))
        tube('Hair | side sweep groove',points,.0025,'hair_hi','Hair','head',resolution=1)


print('STEP 4 — jacket, shirt, tailored pants, gloves, sneakers',flush=True)
zloft('Shirt | fitted core',[(.80,0,-.002,.205,.134),(.82,0,-.002,.209,.138),
    (.93,0,-.002,.209,.143),(1.08,0,0,.24,.151),(1.22,0,0,.271,.154),
    (1.28,0,.006,.233,.133),(1.32,0,.008,.11,.101)],'navy','Shirt',trunk,n=24)
zloft('Shirt | collar binding',[(1.300,0,.010,.11,.102),(1.307,0,.010,.112,.103),
    (1.330,0,.010,.106,.099),(1.335,0,.010,.103,.097)],'rib','Shirt',trunk,n=24)
zloft('Shirt | lower band',[(.800,0,-.002,.211,.14),(.805,0,-.002,.213,.141),
    (.831,0,-.002,.213,.141),(.836,0,-.002,.21,.14)],'rib','Shirt',trunk)
# Original small stacked rising bars, no borrowed logos.
for i in range(3):
    x=-.040+i*.030; z=1.119+i*.017
    patch('Shirt | rise emblem '+str(i),[(x,-.160,1.087),(x+.019,-.160,1.087),
        (x+.019,-.161,z),(x,-.161,z)],'cyan','Shirt',trunk,.002,.003)

# Open-front bomber torso: elliptical shell stops either side of the shirt.
rings=[(.895,.222,.150),(.905,.229,.155),(.942,.231,.158),
       (1.08,.260,.172),(1.22,.295,.173),(1.28,.275,.153),(1.32,.16,.118)]
vs=[];fs=[];N=28
for z,rx,ry in rings:
    for i in range(N):
        a=-math.pi/2+.31+(2*math.pi-.62)*i/(N-1)
        vs.append((rx*math.cos(a),.006+ry*math.sin(a),z))
for j in range(len(rings)-1):
    for i in range(N-1):
        a=j*N+i;fs.append((a,a+1,a+N+1,a+N))
jacket=mesh_obj('Jacket | open bomber shell',vs,fs,'ivory','Jacket',None,sub=1)
bpy.context.view_layer.objects.active=jacket
mod=jacket.modifiers.new('Lined shell','SOLIDIFY');mod.thickness=.010
bpy.ops.object.modifier_apply(modifier=mod.name)
apply_weights(jacket,trunk)

for side,sign in [('L',1),('R',-1)]:
    xloft('Jacket | tailored sleeve '+side,[(.18,.005,1.245,.095,.10),
        (.23,.005,1.245,.118,.127),
        (.29,.005,1.245,.126,.137),(.36,.005,1.245,.120,.128),
        (.46,.005,1.245,.103,.112),(.55,.005,1.245,.098,.107),
        (.60,.005,1.245,.096,.103),(.69,.005,1.245,.089,.096),
        (.77,.005,1.245,.077,.084),(.782,.005,1.245,.074,.080)],
        sign,'ivory','Jacket',arm(side),n=20)
    xloft('Jacket | ink cuff '+side,[(.759,0,1.245,.078,.083),(.765,0,1.245,.079,.085),
        (.800,0,1.245,.067,.068),(.811,0,1.245,.065,.066)],sign,'rib','Jacket',arm(side))
    xloft('Jacket | cyan cuff stitch '+side,[(.790,0,1.245,.070,.072),
        (.794,0,1.245,.070,.072),(.800,0,1.245,.068,.070)],sign,'cyan','Jacket',arm(side),sub=0)
    # Shoulder panel and track seam frame a clean broad silhouette.
    tube('Jacket | shoulder racing seam '+side,[(sign*.185,-.093,1.329),
        (sign*.30,-.096,1.337),(sign*.43,-.079,1.330),
        (sign*.58,-.071,1.323),(sign*.72,-.055,1.311)],.008,'navy','Jacket',arm(side))
    tube('Jacket | cyan sleeve piping '+side,[(sign*.29,-.118,1.294),
        (sign*.42,-.105,1.287),(sign*.58,-.089,1.279),
        (sign*.75,-.076,1.268)],.0045,'cyan','Jacket',arm(side))
    # Front opening tape and bevelled lapel.
    tube('Jacket | zipper tape '+side,[(sign*.071,-.143,.912),(sign*.075,-.152,1.03),
        (sign*.087,-.159,1.18),(sign*.091,-.137,1.282)],.009,'rib','Jacket',trunk)
    tube('Jacket | zipper teeth '+side,[(sign*.061,-.149,.918),(sign*.066,-.158,1.03),
        (sign*.078,-.165,1.18),(sign*.080,-.144,1.277)],.0025,'metal','Jacket',trunk,resolution=1)
    patch('Jacket | folded lapel '+side,[(sign*.074,-.145,1.275),
        (sign*.12,-.122,1.328),(sign*.185,-.109,1.287),(sign*.112,-.169,1.180)],
        'navy','Jacket',trunk,.015,.009)
    tube('Jacket | pocket welt '+side,[(sign*.133,-.153,1.012),(sign*.198,-.128,1.067)],
        .010,'navy','Jacket',trunk)
    tube('Jacket | pocket cyan stitch '+side,[(sign*.139,-.162,1.014),(sign*.196,-.139,1.061)],
        .0028,'cyan_dark','Jacket',trunk)
    # Hem front and back sections follow the actual shell.
    points=[]
    for i in range(18):
        a=-math.pi/2+.32+(math.pi-.32)*i/17
        points.append((sign*.229*math.cos(a),.006+.155*math.sin(a),.915))
    tube('Jacket | rib hem '+side,points,.023,'rib','Jacket',trunk,resolution=2)
    # Adult, restrained fingerless combat gloves with separate articulated fingers.
    xloft('Glove | palm '+side,[(.837,0,1.245,.054,.050),(.85,0,1.245,.057,.051),
        (.91,0,1.245,.068,.049),(.961,0,1.245,.065,.042),
        (.977,0,1.245,.057,.034)],sign,'rib','Gloves.'+side,'hand.'+side,n=16)
    patch('Glove | knuckle guard '+side,[(sign*.89,-.047,1.28),(sign*.945,-.052,1.276),
        (sign*.957,.042,1.276),(sign*.896,.044,1.28)],'navy','Gloves.'+side,'hand.'+side,.012,.009)
    tube('Glove | cyan strap '+side,[(sign*.858,-.052,1.265),(sign*.86,0,1.298),
        (sign*.858,.052,1.267)],.006,'cyan','Gloves.'+side,'hand.'+side)
    lengths=[.108,.126,.116,.091]
    for i,(y,l) in enumerate(zip([-.048,-.016,.017,.048],lengths)):
        bone='finger_%d.%s'%(i+1,side)
        xloft('Finger %d %s'%(i+1,side),[(.953,y,1.242,.017,.023),
            (.975,y,1.242,.017,.023),(1.005,y,1.242,.015,.020),
            (.958+l-.014,y,1.240,.014,.017),(.958+l,y,1.240,.005,.008)],
            sign,'skin','Hands',bone,n=10,sub=1)
        xloft('Glove | finger collar %d %s'%(i+1,side),[(.948,y,1.242,.020,.026),
            (.958,y,1.242,.020,.026),(.981,y,1.242,.018,.024)],
            sign,'rib','Gloves.'+side,bone,n=10,sub=1)
    # Thumb points outward from the forward edge of the hand.
    ellipsoid('Thumb base '+side,(sign*.902,-.064,1.225),(.038,.032,.034),'rib',
        'Gloves.'+side,'hand.'+side,seg=16,rings=10)
    lock_points=[(sign*.905,-.071,1.222),(sign*.934,-.092,1.214),(sign*.959,-.10,1.216)]
    # Thumb capsule oriented along a segment.
    a=Vector(lock_points[0]);b=Vector(lock_points[-1]);mid=(a+b)/2
    obj=ellipsoid('Thumb '+side,mid,(.024,.024,(b-a).length*.65),'skin','Hands','thumb.'+side,seg=16,rings=12)
    # Rotate baked vertices about its center from Z toward the thumb direction.
    q=Vector((0,0,1)).rotation_difference((b-a).normalized())
    for v in obj.data.vertices:
        v.co=mid+q@(v.co-mid)

# Short standing collar, with an open front.
tube('Jacket | rear collar',[(.099,-.052,1.337),(.129,.024,1.358),
    (0,.119,1.364),(-.129,.024,1.358),(-.099,-.052,1.337)],.025,'navy','Jacket',trunk)
patch('Jacket | amber zip pull',[(.064,-.163,.949),(.079,-.163,.944),
    (.079,-.164,.912),(.064,-.164,.917)],'orange','Jacket',trunk,.008,.004)
# Back graphic: original arena chevron and tiny contrasting center tab.
tube('Jacket | back chevron',[(-.205,.146,1.205),(0,.186,1.131),(.205,.146,1.205)],
    .010,'navy','Jacket',trunk)
tube('Jacket | back cyan chevron',[(-.181,.151,1.216),(0,.184,1.151),(.181,.151,1.216)],
    .004,'cyan','Jacket',trunk)
patch('Jacket | rear neck tab',[(-.018,.129,1.298),(.018,.129,1.298),
    (.018,.139,1.258),(-.018,.139,1.258)],'cyan','Jacket',trunk,.003,.003)

# Pants: compact pelvis plus shaped legs. Rings at knee support later deformation.
zloft('Pants | pelvis',[(.665,0,.018,.185,.110),(.70,0,.012,.212,.137),
    (.78,0,.006,.219,.145),(.824,0,.002,.211,.143),(.842,0,.002,.207,.140)],
    'pants','PantsCore','pelvis',n=24,sub=1)
zloft('Pants | waistband',[(.810,0,.002,.214,.145),(.816,0,.002,.216,.147),
    (.846,0,.002,.211,.145),(.852,0,.002,.208,.141)],'rib','Pants','pelvis',sub=1)
for side,sign in [('L',1),('R',-1)]:
    zloft('Pants | tailored leg '+side,[(.175,sign*.142,.019,.071,.074),
        (.194,sign*.142,.019,.073,.077),(.285,sign*.146,.021,.079,.083),
        (.375,sign*.151,.020,.089,.091),(.421,sign*.152,.016,.095,.093),
        (.465,sign*.150,.013,.096,.099),(.54,sign*.142,.010,.105,.110),
        (.64,sign*.128,.010,.119,.123),(.73,sign*.117,.007,.123,.133),
        (.78,sign*.114,.005,.116,.132)],'pants','PantsCore',leg(side),n=20,sub=1)
    zloft('Pants | ankle cuff '+side,[(.167,sign*.142,.019,.072,.076),
        (.172,sign*.142,.019,.075,.078),(.214,sign*.142,.019,.077,.080),
        (.220,sign*.142,.019,.075,.079)],'rib','Pants',leg(side),n=16)
    tube('Pants | outer side seam '+side,[(sign*.206,.018,.25),(sign*.239,.019,.42),
        (sign*.248,.014,.58),(sign*.234,.007,.74)],.0035,'cyan_dark','Pants',leg(side))
    tube('Pants | pocket stitch '+side,[(sign*.129,-.133,.787),(sign*.164,-.121,.731),
        (sign*.202,-.089,.709)],.003,'cyan_dark','Pants',leg(side))
    tube('Pants | knee dart '+side,[(sign*.091,-.076,.443),(sign*.15,-.083,.426),
        (sign*.207,-.070,.437)],.0025,'navy','Pants',leg(side))
    # Sneakers have a broad square toe, narrow heel, layered sole, raised tongue.
    cx=sign*.142
    zloft('Shoe | outsole '+side,[(.012,cx,-.066,.102,.185),(.020,cx,-.066,.111,.193),
        (.047,cx,-.066,.113,.195),(.063,cx,-.066,.110,.192)],
        'shoe','Shoes.'+side,'foot.'+side,n=28,exponent=.61,sub=1)
    zloft('Shoe | sculpted midsole '+side,[(.046,cx,-.067,.112,.193),
        (.055,cx,-.067,.113,.193),(.096,cx,-.063,.107,.185),
        (.103,cx,-.061,.104,.181)],'sole','Shoes.'+side,'foot.'+side,n=28,exponent=.65,sub=1)
    zloft('Shoe | upper '+side,[(.093,cx,-.062,.103,.178),(.104,cx,-.061,.104,.177),
        (.145,cx,-.052,.099,.165),(.181,cx,-.025,.082,.127),
        (.208,cx,.016,.074,.087),(.218,cx,.021,.068,.078)],
        'shoe','Shoes.'+side,'foot.'+side,n=28,exponent=.8,sub=1)
    # Toe reinforcement panel follows sloping upper front.
    tube('Shoe | toe seam '+side,[(cx-.085,-.128,.144),(cx-.067,-.185,.138),
        (cx,-.214,.132),(cx+.067,-.185,.138),(cx+.085,-.128,.144)],
        .006,'ivory','Shoes.'+side,'foot.'+side)
    patch('Shoe | tongue '+side,[(cx-.035,-.116,.157),(cx+.035,-.116,.157),
        (cx+.033,-.047,.217),(cx-.033,-.047,.217)],'navy','Shoes.'+side,'foot.'+side,.012,.008)
    for j in range(4):
        y=-.123+j*.019;z=.166+j*.014
        tube('Shoe | lace %d %s'%(j,side),[(cx-.034,y,z),(cx,y-.008,z+.005),
            (cx+.034,y,z)],.004,'ivory','Shoes.'+side,'foot.'+side,resolution=1)
    tube('Shoe | cyan heel rail '+side,[(cx-sign*.087,.003,.134),
        (cx-sign*.066,.092,.143),(cx,.112,.149),(cx+sign*.066,.092,.143)],
        .009,'cyan','Shoes.'+side,'foot.'+side)
    # Single graphic side panel provides readable color without texture dependency.
    patch('Shoe | side blade '+side,[(cx+sign*.101,-.11,.105),
        (cx+sign*.104,-.06,.12),(cx+sign*.091,.046,.175),
        (cx+sign*.085,.052,.149),(cx+sign*.103,-.047,.109)],
        'ivory','Shoes.'+side,'foot.'+side,.004,.005)
    tube('Shoe | heel pull '+side,[(cx-.018,.100,.183),(cx-.018,.106,.227),
        (cx+.018,.106,.227),(cx+.018,.100,.183)],.006,'cyan','Shoes.'+side,'foot.'+side)


# Union the three trouser shells so the crotch and upper thighs have continuous
# surfaces rather than intersecting low-poly edges. Re-author the skin afterwards.
core=PARTS.pop('PantsCore')
bpy.ops.object.select_all(action='DESELECT')
for obj in core:obj.select_set(True)
bpy.context.view_layer.objects.active=core[0]
bpy.ops.object.join()
core=core[0]
mod=core.modifiers.new('Union tailored trouser core','REMESH')
mod.mode='VOXEL';mod.voxel_size=.008;mod.use_smooth_shade=True
bpy.ops.object.modifier_apply(modifier=mod.name)
mod=core.modifiers.new('Relax trouser junctions','SMOOTH');mod.factor=.8;mod.iterations=3
bpy.ops.object.modifier_apply(modifier=mod.name)
mod=core.modifiers.new('Trouser core budget','DECIMATE')
mod.ratio=min(1,5000/sum(len(p.vertices)-2 for p in core.data.polygons))
bpy.ops.object.modifier_apply(modifier=mod.name)
core.vertex_groups.clear()
apply_weights(core,lambda v:leg('L' if v.x>=0 else 'R')(v))
PARTS['Pants'].append(core)

print('STEP 5 — consolidate materials and mesh parts',flush=True)
objects=[]
for part,obs in PARTS.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:o.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]
    bpy.ops.object.join()
    obj=bpy.context.object
    obj.name=part
    # Collapse repeated material slots created when joining procedural panels.
    old=list(obj.data.materials);unique=[];remap={}
    for i,m in enumerate(old):
        if m not in unique:unique.append(m)
        remap[i]=unique.index(m)
    inds=[remap[p.material_index] for p in obj.data.polygons]
    obj.data.materials.clear()
    for m in unique:obj.data.materials.append(m)
    for p,i in zip(obj.data.polygons,inds):p.material_index=i
    objects.append(obj)

# Bake a modest simplification into dense procedural surfaces. Keep the small eye
# lenses intact, and retain named vertex groups through Blender's collapse operator.
raw_triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
ratio=min(1.0,args.triangle_budget/raw_triangles)
for obj in objects:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    if ratio < 1 and obj.name!='Eyes':
        mod=obj.modifiers.new('Baked mobile surface budget','DECIMATE')
        mod.ratio=ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # A usable UV baseline for later texture work; materials themselves are texture-free.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.025)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj['customization_part']=obj.name

# Ground the soles exactly; the rig root remains at world origin.
ground_offset=min(v.co.z for obj in objects for v in obj.data.vertices)
for obj in objects:
    for v in obj.data.vertices:
        v.co.z-=ground_offset


print('STEP 6 — humanoid deformation skeleton',flush=True)
armdata=bpy.data.armatures.new('Rook | humanoid skeleton')
rig=bpy.data.objects.new('HeroRig',armdata)
hero_col.objects.link(rig)
rig.show_in_front=True
rig.data.display_type='OCTAHEDRAL'
bpy.context.view_layer.objects.active=rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')


def bone(name,head,tail,parent=None,deform=True):
    b=armdata.edit_bones.new(name)
    offset=0 if name=='root' else ground_offset
    b.head=(head[0],head[1],head[2]-offset)
    b.tail=(tail[0],tail[1],tail[2]-offset)
    b.use_deform=deform
    if parent:b.parent=armdata.edit_bones[parent]
    return b


bone('root',(0,0,0),(0,0,.17),deform=False)
bone('pelvis',(0,0,.77),(0,0,.90),'root')
bone('spine',(0,0,.90),(0,0,1.09),'pelvis')
bone('chest',(0,0,1.09),(0,0,1.30),'spine')
bone('neck',(0,0,1.30),(0,0,1.43),'chest')
bone('head',(0,0,1.43),(0,0,1.93),'neck')
for side,sign in [('L',1),('R',-1)]:
    bone('clavicle.'+side,(sign*.04,0,1.265),(sign*.28,0,1.245),'chest')
    bone('upper_arm.'+side,(sign*.28,0,1.245),(sign*.59,0,1.245),'clavicle.'+side)
    bone('forearm.'+side,(sign*.59,0,1.245),(sign*.845,0,1.245),'upper_arm.'+side)
    bone('hand.'+side,(sign*.845,0,1.245),(sign*.971,0,1.242),'forearm.'+side)
    for i,(y,l) in enumerate(zip([-.048,-.016,.017,.048],[.108,.126,.116,.091])):
        bone('finger_%d.%s'%(i+1,side),(sign*.967,y,1.242),(sign*(.958+l),y,1.24),'hand.'+side)
    bone('thumb.'+side,(sign*.905,-.064,1.223),(sign*.965,-.10,1.216),'hand.'+side)
    bone('thigh.'+side,(sign*.112,0,.79),(sign*.151,.016,.432),'pelvis')
    bone('shin.'+side,(sign*.151,.016,.432),(sign*.142,.019,.178),'thigh.'+side)
    bone('foot.'+side,(sign*.142,.019,.178),(sign*.142,-.153,.075),'shin.'+side)
    bone('toe.'+side,(sign*.142,-.153,.075),(sign*.142,-.234,.075),'foot.'+side)
bpy.ops.object.mode_set(mode='OBJECT')
for obj in objects:
    obj.parent=rig
    mod=obj.modifiers.new('Hero skin — normalized authored weights','ARMATURE')
    mod.object=rig
    # Standard linear skinning is used both in Blender and glTF.
    mod.use_deform_preserve_volume=False
rig['character']='ROOK — original PRIME TIME: SHOWDOWN fighter'
rig['orientation']='Blender: Z up, front -Y. GLB: Y up, front +Z.'
rig['rig_note']='Deformation rig, T-pose bind. One joint per finger; no IK or facial controls.'


print('STEP 7 — validate and export clean GLB',flush=True)
errors=[]
for obj in objects:
    for v in obj.data.vertices:
        total=sum(g.weight for g in v.groups)
        if abs(total-1)>1e-4:errors.append('%s vertex %d weights %.4f'%(obj.name,v.index,total))
    if any(abs(a)>1e-6 for a in obj.rotation_euler):errors.append(obj.name+' rotation not identity')
    if any(abs(a-1)>1e-6 for a in obj.scale):errors.append(obj.name+' scale not identity')
if errors:raise RuntimeError('\n'.join(errors[:20]))
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
vertices=sum(len(o.data.vertices) for o in objects)
bounds=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
mins=[min(v[i] for v in bounds) for i in range(3)]
maxs=[max(v[i] for v in bounds) for i in range(3)]
stats={'character':'Rook','blender_version':bpy.app.version_string,'mesh_objects':len(objects),
    'vertices':vertices,'triangles':triangles,'materials':len(MAT),'bones':len(armdata.bones),
    'height_m':round(maxs[2]-mins[2],4),'bounds_min':mins,'bounds_max':maxs,
    'front_blender':'-Y','front_glb':'+Z','unit':'meter','bind_pose':'T',
    'parts':[o.name for o in objects],'weight_errors':len(errors)}
print('Geometry: %d triangles / %d vertices'%(triangles,vertices),flush=True)
if triangles>60000:raise RuntimeError('Unexpected triangle budget: %d'%triangles)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'hero_base.glb'),export_format='GLB',
    use_selection=True,export_yup=True,export_apply=False,export_animations=False,
    export_skins=True,export_all_influences=False,export_extras=True,
    export_texcoords=True,export_normals=True,export_materials='EXPORT')
(OUT/'asset_report.json').write_text(json.dumps(stats,indent=2))


print('STEP 8 — preview studio and four cameras',flush=True)
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=args.render_size
scene.render.resolution_y=args.render_size
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.11,.15,.20,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
scene.view_settings.view_transform='Filmic'
scene.view_settings.look='Medium High Contrast'
scene.view_settings.exposure=0
scene.view_settings.gamma=1


def aim(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def area(name,loc,energy,size,color,target=(0,0,1)):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);studio_col.objects.link(obj);obj.location=loc;aim(obj,target)


area('Key | large warm softbox',(-3,-4,5),420,4,(1,.86,.72))
area('Fill | cool front',(3,-2,2.7),240,3,(.63,.83,1))
area('Rim | cyan separation',(1.6,3,3.5),480,2.3,(.45,.82,1))
area('Back | soft bounce',(-2,2,2),170,3,(1,.88,.73))
floor_mat=material('STUDIO | slate backdrop',(.032,.047,.069),.9)
bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,0))
floor=bpy.context.object;floor.name='STUDIO | shadow floor';move_to(floor,studio_col)
floor.data.materials.append(floor_mat)
cameras={}
for name,loc,ortho in [('perspective',(3.1,-5.0,2.65),2.7),
                        ('front',(0,-6,1.015),2.65),
                        ('side',(6,0,1.015),2.65),
                        ('back',(0,6,1.015),2.65)]:
    data=bpy.data.cameras.new('Preview | '+name)
    obj=bpy.data.objects.new('Preview | '+name,data)
    studio_col.objects.link(obj);obj.location=loc;aim(obj,(0,0,1.015))
    data.type='ORTHO' if name!='perspective' else 'PERSP'
    data.ortho_scale=ortho;data.lens=67
    cameras[name]=obj
scene.camera=cameras['perspective']

# Default workspace opens on the character, with studio helpers hidden in viewport.
for obj in studio_col.objects:obj.hide_set(True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.region_3d.view_distance=3.7
            ar.spaces.active.region_3d.view_location=Vector((0,0,1.02))
            ar.spaces.active.region_3d.view_rotation=cameras['perspective'].rotation_euler.to_quaternion()
            ar.spaces.active.shading.type='MATERIAL'
            ar.spaces.active.overlay.show_floor=False
scene['README']='See README.md beside this blend. Character-only GLB excludes STUDIO collection.'
text=bpy.data.texts.new('ABOUT ROOK')
text.write('ROOK / PRIME TIME: SHOWDOWN\nOriginal stylized street-arena fighter.\n\n'
    'Meters; Z up; front -Y; T-pose bind.\nSeparate customizable mesh parts; authored normalized skin weights.\n'
    'STUDIO collection is preview only and is excluded from GLB.\n'
    'Rebuild with create_hero.py. See README.md and asset_report.json.\n\n'+json.dumps(stats,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hero_base.blend'))
if not args.skip_renders:
    for name,camera in cameras.items():
        scene.camera=camera
        scene.render.filepath=str(OUT/'previews'/('hero_'+name+'.png'))
        bpy.ops.render.render(write_still=True)
        print('RENDERED '+name,flush=True)
scene.camera=cameras['perspective']
scene.render.filepath=str(OUT/'previews'/'hero_perspective.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hero_base.blend'))
print('COMPLETE '+json.dumps(stats),flush=True)
