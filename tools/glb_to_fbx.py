# Blender: GLB -> FBX for Mixamo's auto-rigger.
#   Blender --background --python glb_to_fbx.py -- <src.glb> <dst.fbx>
#
# The source is triangle soup: every triangle carries its own copies of its
# three corners, so the mesh imports as thousands of disconnected shells with
# most of its edges non-manifold. Mixamo's auto-rigger walks a connected
# surface to find the limbs, so it is welded here before export.
import bpy, sys, bmesh

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = ob
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

# Human-ish height keeps the auto-rigger's marker placement sane.
h = ob.dimensions.z                       # Blender is Z-up
k = 1.7 / h if h else 1.0
ob.scale = (k, k, k)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
print(f'HEIGHT {h:.4f} -> {ob.dimensions.z:.4f} m')

bpy.ops.export_scene.fbx(
    filepath=dst, use_selection=False, apply_unit_scale=True,
    axis_forward='-Z', axis_up='Y',
    object_types={'MESH'}, use_mesh_modifiers=True, mesh_smooth_type='FACE',
    path_mode='COPY', embed_textures=True,
)
print('WROTE', dst)
