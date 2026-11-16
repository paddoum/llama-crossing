# Blender: GLB -> FBX for Mixamo's auto-rigger.
#   Blender --background --python glb_to_fbx.py -- <src.glb> <dst.fbx> [--tpose] [--preview <dir>]
#
# The source is triangle soup: every triangle carries its own copies of its
# three corners, so the mesh imports as thousands of disconnected shells with
# most of its edges non-manifold. Mixamo's auto-rigger walks a connected
# surface to find the limbs, so it is welded here before export.
#
# --tpose additionally poses the llama into a T. It is sculpted standing with
# its forelegs bent and tucked against its chest, hands almost touching, which
# gives an auto-rigger nothing to separate: it tends to weld the arms into the
# torso and rig a snowman. See build_tpose below.
import bpy, sys, bmesh, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
TPOSE = '--tpose' in argv
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
# auto | 0 | 180: which way to spin the model before export. See "FACING" below.
TURN = argv[argv.index('--turn') + 1] if '--turn' in argv else 'auto'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# Clothed characters often arrive as several objects (body, shirt, shorts).
# Mixamo rigs one mesh, so join them before anything else measures the model.
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
ob = meshes[0]
bpy.context.view_layer.objects.active = ob
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
if len(meshes) > 1:
    bpy.ops.object.join()
    print(f'JOINED  {len(meshes)} mesh objects into one')
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def survey(label):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
    seen, shells = set(), 0
    for v in bm.verts:
        if v.index in seen:
            continue
        shells += 1
        stack = [v]; seen.add(v.index)
        while stack:
            w = stack.pop()
            for e in w.link_edges:
                u = e.other_vert(w)
                if u.index not in seen:
                    seen.add(u.index); stack.append(u)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    print(f'{label:7} verts {len(bm.verts):6d}  faces {len(bm.faces):6d}  '
          f'shells {shells:6d}  non-manifold edges {nm:6d}/{len(bm.edges)}')
    bm.free()
    return shells, nm


survey('BEFORE')

bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(ob.data); ob.data.update(); bm.free()

survey('WELDED')


def only(obj):
    # Deleting an object leaves the view layer with no active one, and
    # mode_set refuses to poll without it.
    if bpy.context.view_layer.objects.active:
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.data.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def build_tpose(ob):
    """Throw a skeleton at the llama, swing the arms out, bake the result.

    Landmarks are read off the mesh as fractions of its height rather than
    hard-coded in model units, so the numbers survive the model being
    re-exported at a different scale. They come from slicing the welded mesh
    into height bands and watching where the x-lobes in front of the torso sit:
    the forearms show up between 47% and 58% of the height, travelling from
    x +/-0.21 at the elbow up and inward to +/-0.12 at the paws.
    """
    co = [v.co for v in ob.data.vertices]
    lo = min(v.z for v in co); hi = max(v.z for v in co)
    H = hi - lo
    W = max(abs(v.x) for v in co)            # half-width, for the limb offsets
    Z = lambda p: lo + H * p
    X = lambda f: W * f

    spine = [
        ('hips',  Vector((0, 0.00, Z(0.33))), Vector((0, 0.00, Z(0.45))), None),
        ('spine', Vector((0, 0.00, Z(0.45))), Vector((0, 0.00, Z(0.60))), 'hips'),
        ('neck',  Vector((0, 0.00, Z(0.60))), Vector((0, -0.02 * H, Z(0.68))), 'spine'),
        ('head',  Vector((0, -0.02 * H, Z(0.68))), Vector((0, -0.02 * H, Z(0.95))), 'neck'),
    ]
    limbs = []
    for s, side in ((1, 'L'), (-1, 'R')):
        shoulder = Vector((s * X(0.45), -0.016 * H, Z(0.59)))
        elbow    = Vector((s * X(0.65), -0.090 * H, Z(0.47)))
        hand     = Vector((s * X(0.36), -0.168 * H, Z(0.57)))
        tip      = hand + (hand - elbow).normalized() * (0.05 * H)
        limbs += [
            (f'upperarm.{side}', shoulder, elbow, 'spine'),
            (f'forearm.{side}',  elbow,    hand,  f'upperarm.{side}'),
            (f'hand.{side}',     hand,     tip,   f'forearm.{side}'),
            (f'thigh.{side}', Vector((s * X(0.30), 0, Z(0.33))), Vector((s * X(0.38), -0.01 * H, Z(0.22))), 'hips'),
            (f'shin.{side}',  Vector((s * X(0.38), -0.01 * H, Z(0.22))), Vector((s * X(0.40), 0, Z(0.08))), f'thigh.{side}'),
            (f'foot.{side}',  Vector((s * X(0.40), 0, Z(0.08))), Vector((s * X(0.40), -0.06 * H, Z(0.01))), f'shin.{side}'),
        ]

    arm = bpy.data.objects.new('rig', bpy.data.armatures.new('rig'))
    bpy.context.scene.collection.objects.link(arm)
    only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in spine + limbs:
        b = arm.data.edit_bones.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = arm.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')

    # Bone heat needs a surface it can solve over; envelopes always work.
    only(ob)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        print('BIND    bone heat')
    except RuntimeError as e:
        print('BIND    bone heat failed (%s), falling back to envelopes' % e)
        bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')

    # Swing each arm bone onto the x axis, shoulder first: a pose bone's matrix
    # is in armature space, so the parent has to be settled before the child is
    # measured against it.
    only(arm)
    bpy.ops.object.mode_set(mode='POSE')
    for s, side in ((1, 'L'), (-1, 'R')):
        for name in (f'upperarm.{side}', f'forearm.{side}', f'hand.{side}'):
            pb = arm.pose.bones[name]
            head = pb.matrix.to_translation()
            rot = Vector((s, 0, 0)).to_track_quat('Y', 'Z').to_matrix().to_4x4()
            pb.matrix = Matrix.Translation(head) @ rot
            bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')

    # Bake the pose into the mesh and throw the scaffolding away.
    only(ob)
    for m in ob.modifiers:
        if m.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=m.name)
    ob.parent = None
    ob.matrix_world = Matrix.Identity(4)
    ob.vertex_groups.clear()
    only(arm)
    bpy.ops.object.delete()
    only(ob)

    span = max(v.co.x for v in ob.data.vertices) - min(v.co.x for v in ob.data.vertices)
    print(f'TPOSE   arm span {span:.3f} against height {H:.3f}  ({span / H:.2f}x)')


if TPOSE:
    build_tpose(ob)

# Blender's FBX exporter maps its own forward (-Y) onto -Z, and auto-riggers
# expect a character to face +Z, so the model wants to be facing Blender +Y on
# the way out. Which way it currently faces is measured rather than assumed,
# because that differs per source: the snout is whichever end of the head
# reaches furthest from the body's own depth midline.
#
# The mesh data is rotated rather than the object: the glTF importer leaves
# objects in quaternion rotation mode, where assigning rotation_euler is
# silently ignored and transform_apply has nothing to bake.
only(ob)


def head_reach():
    """How far the head pokes out each way, measured off the body's midline."""
    co = [v.co for v in ob.data.vertices]
    lo = min(v.z for v in co); top = max(v.z for v in co)
    mid = (min(v.y for v in co) + max(v.y for v in co)) / 2
    head = [v.y - mid for v in co if v.z > lo + (top - lo) * 0.72]
    return min(head), max(head)


back, front = head_reach()
turn = (abs(back) > abs(front)) if TURN == 'auto' else (TURN == '180')
print(f'FACING  head reaches {back:+.3f} / {front:+.3f} about the midline '
      f'-> snout at {"-Y" if abs(back) > abs(front) else "+Y"}, turn={turn}')
if turn:
    ob.data.transform(Matrix.Rotation(3.141592653589793, 4, 'Z'))
    back, front = head_reach()
    print(f'FACING  after the turn: {back:+.3f} / {front:+.3f}')
if abs(front) <= abs(back):
    print('FACING  WARNING: the snout still does not read as +Y; check the preview')

# Human-ish height keeps the auto-rigger's marker placement sane.
h = ob.dimensions.z                       # Blender is Z-up
k = 1.7 / h if h else 1.0
ob.scale = (k, k, k)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
print(f'HEIGHT {h:.4f} -> {ob.dimensions.z:.4f} m')

if PREVIEW:
    import math
    for mslot in list(ob.data.materials):
        pass
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = 420, 560
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'SINGLE'; sh.single_color = (0.75, 0.75, 0.78)
    sh.show_cavity = True
    cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = max(ob.dimensions) * 1.15
    cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
    mid = (ob.dimensions.z / 2) + min(v.co.z for v in ob.data.vertices)
    for name, loc, rot in (
        ('front', (0, 6, mid), (math.pi / 2, 0, math.pi)),
        ('side',  (6, 0, mid), (math.pi / 2, 0, math.pi / 2)),
    ):
        cam.location = loc; cam.rotation_euler = rot
        sc.render.filepath = os.path.join(PREVIEW, name + '.png')
        bpy.ops.render.render(write_still=True)
        print('PREVIEW', sc.render.filepath)

only(ob)
bpy.ops.export_scene.fbx(
    filepath=dst, use_selection=False, apply_unit_scale=True,
    axis_forward='-Z', axis_up='Y',
    object_types={'MESH'}, use_mesh_modifiers=True, mesh_smooth_type='FACE',
    path_mode='COPY', embed_textures=True,
)
print('WROTE', dst)
