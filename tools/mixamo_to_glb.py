# Blender: Mixamo FBX clips -> one rigged GLB the game can load.
#   Blender --background --python mixamo_to_glb.py -- <skin.glb> <out.glb> \
#           --clip paddle=Paddling.fbx --clip dance="Brooklyn Uprock.fbx"
#
# Mixamo gives you one FBX per animation, each carrying its own copy of the
# same rig and mesh. The game wants one model with several clips on it, so the
# first FBX supplies the rig and the skin and every later one contributes only
# its action, stashed onto that rig as an NLA strip (which is what the glTF
# exporter walks to decide what to write out).
#
# Two things Mixamo's round trip gets wrong for us:
#   - the material points at a texture inside Mixamo's own upload folder, a
#     path that does not exist here, so the skin is re-linked from the GLB that
#     was uploaded in the first place;
#   - the result does not sit at the origin. That is harmless in a viewer and
#     very much not harmless in a game that scales the model ~30x, so the rig
#     is moved until the rest pose stands with its hooves on the origin.
import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:]
skin, dst = argv[0], argv[1]
# A 2048 skin is most of the file. 1024 is plenty at the size the llama is
# drawn on a phone, and roughly quarters the bytes the player has to download.
TEX = int(argv[argv.index('--texture') + 1]) if '--texture' in argv else 0
JPEG = '--jpeg' in argv
clips = []
for i, a in enumerate(argv):
    if a == '--clip':
        name, _, path = argv[i + 1].partition('=')
        clips.append((name, path))
if not clips:
    raise SystemExit('need at least one --clip NAME=file.fbx')

bpy.ops.wm.read_factory_settings(use_empty=True)

# 1. The skin: import the original GLB only to keep its baked-in texture.
bpy.ops.import_scene.gltf(filepath=skin)
texture = None
for img in bpy.data.images:
    if img.size[0] and img.size[1]:
        if texture is None or img.size[0] * img.size[1] > texture.size[0] * texture.size[1]:
            texture = img
if texture is None:
    raise SystemExit('no texture found in ' + skin)
texture.use_fake_user = True          # survives the purge when its mesh goes
print(f'SKIN    {texture.name!r} {texture.size[0]}x{texture.size[1]} from {os.path.basename(skin)}')
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path, use_image_search=False)
    new = [o for o in bpy.data.objects if o not in before]
    acts = [a for a in bpy.data.actions if a not in before_actions]
    return new, (acts[0] if acts else None)


# 2. The rig, the mesh and the first clip.
objs, act = import_fbx(clips[0][1])
arm = next(o for o in objs if o.type == 'ARMATURE')
mesh = next(o for o in objs if o.type == 'MESH')
fps = bpy.context.scene.render.fps
print(f'RIG     {len(arm.data.bones)} bones, mesh {len(mesh.data.vertices)} verts, '
      f'{len(mesh.vertex_groups)} weight groups')

if arm.animation_data is None:
    arm.animation_data_create()


def stash(action, name):
    action.name = name
    action.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(action.frame_range[0]), action)
    span = (action.frame_range[1] - action.frame_range[0]) / fps
    print(f'CLIP    {name!r} frames {action.frame_range[0]:.0f}..{action.frame_range[1]:.0f} '
          f'@ {fps}fps = {span:.2f}s')


stash(act, clips[0][0])

# 3. Every other FBX: keep its action, throw the duplicate rig and mesh away.
for name, path in clips[1:]:
    objs2, act2 = import_fbx(path)
    if act2 is None:
        raise SystemExit('no action in ' + path)
    stash(act2, name)
    for o in objs2:
        bpy.data.objects.remove(o, do_unlink=True)

arm.animation_data.action = None      # otherwise the active action exports twice

# 4. Re-link the skin onto whatever material came in with the FBX.
for mat in mesh.data.materials:
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        continue
    tex = next((n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE'), None)
    if tex is None:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        mat.node_tree.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])
    tex.image = texture
    # Mixamo's FBX material arrives shiny; the source is matte cloth and fur.
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.85
    print(f'MAT     {mat.name!r} <- {texture.name!r}')

if TEX and (texture.size[0] > TEX or texture.size[1] > TEX):
    was = tuple(texture.size)
    texture.scale(TEX, TEX)
    texture.pack()                    # the exporter writes what is packed
    print(f'TEXTURE {was[0]}x{was[1]} -> {texture.size[0]}x{texture.size[1]}')

# 5. Stand the rest pose on the origin.
#
# Mixamo's native scale is left alone on purpose. Applying it rescales the
# armature's rest pose but NOT the bone-location channels inside the clips,
# which stay in centimetres -- the rig then reads its own animation as a
# hundredfold and the llama is flung a thousand units into the sky. The game
# scales the whole thing by one number instead, which works because the mesh
# and its skeleton sit under the same node.
bpy.context.view_layer.objects.active = arm


def rest_box():
    """World-space bounds of the mesh with no clip playing."""
    bpy.context.view_layer.update()
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


lo, hi = rest_box()
print(f'SIZE    {hi[0]-lo[0]:.3f} x {hi[1]-lo[1]:.3f} x {hi[2]-lo[2]:.3f}')
print(f'BEFORE  x {lo[0]:+.3f}..{hi[0]:+.3f}  y {lo[1]:+.3f}..{hi[1]:+.3f}  z {lo[2]:+.3f}..{hi[2]:+.3f}')
arm.location.x -= (lo[0] + hi[0]) / 2
arm.location.y -= (lo[1] + hi[1]) / 2
arm.location.z -= lo[2]                      # hooves on the floor, Blender is Z-up
arm.scale = (1, 1, 1) if arm.scale.x == 0 else arm.scale
lo, hi = rest_box()
print(f'CENTRED x {lo[0]:+.3f}..{hi[0]:+.3f}  y {lo[1]:+.3f}..{hi[1]:+.3f}  z {lo[2]:+.3f}..{hi[2]:+.3f}')

bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB',
    export_image_format='JPEG' if JPEG else 'AUTO',
    export_animations=True, export_force_sampling=True, export_nla_strips=True,
    export_skins=True, export_morph=False, export_apply=False,
    export_yup=True,
)
print('WROTE', dst, os.path.getsize(dst), 'bytes')
