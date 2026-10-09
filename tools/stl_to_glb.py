#!/usr/bin/env python3
"""Turn the printable boat STL into a web-ready GLB.

The source is a 3D-printing model: ~328k triangles at sub-millimetre density,
Z-up, bow at +Y, with a flat base plate under the hull. This script

  * drops the base plate,
  * splits the mesh into hull / spars / sails so each can take its own colour
    (STL carries no materials),
  * decimates the hull by vertex clustering -- it is 99% of the triangles and
    is a smooth solid, so it takes it well; the thin spars and sails are kept
    as they are, because clustering would eat them,
  * reorients to the game's axes (Y up, bow toward -Z) and puts the waterline
    at y = 0,
  * writes an indexed GLB with smooth normals.

    python3 tools/stl_to_glb.py <input.stl> <output.glb> [cell]
"""
import json
import struct
import sys

import numpy as np

RIG_Z = 40.0        # everything above this is mast and sails
SAIL_X = 1.2        # sails are thin plates on the centre line
BASE_Z = 1.0        # the print raft sits below this
WATERLINE = 26.0    # STL z that should become y = 0 (hull is widest here)
DEFAULT_CELL = 1.55


def load_stl(path):
    raw = np.fromfile(path, dtype=np.uint8)
    n = int(raw[80:84].view(np.uint32)[0])
    dt = np.dtype([('n', '<3f4'), ('v', '<3,3f4'), ('a', '<u2')])
    return raw[84:84 + n * 50].view(dt)['v'].astype(np.float64)


def weld(tris):
    """Indexed mesh from a triangle soup, exact-match welding."""
    verts = tris.reshape(-1, 3)
    uniq, inv = np.unique(verts, axis=0, return_inverse=True)
    return uniq, inv.reshape(-1, 3).astype(np.uint32)


def cluster(tris, cell):
    """Vertex-clustering decimation: snap to a grid, average each cell."""
    verts = tris.reshape(-1, 3)
    grid = np.floor((verts - verts.min(0)) / cell).astype(np.int64)
    dims = grid.max(0) + 1
    key = (grid[:, 0] * dims[1] + grid[:, 1]) * dims[2] + grid[:, 2]
    uniq, inv = np.unique(key, return_inverse=True)
    counts = np.bincount(inv)
    reps = np.stack([np.bincount(inv, weights=verts[:, i]) for i in range(3)], 1) / counts[:, None]
    idx = inv.reshape(-1, 3)
    ok = (idx[:, 0] != idx[:, 1]) & (idx[:, 1] != idx[:, 2]) & (idx[:, 0] != idx[:, 2])
    idx = np.unique(np.sort(idx[ok], axis=1), axis=0)
    return reps, idx.astype(np.uint32)


def normals(verts, idx):
    a, b, c = verts[idx[:, 0]], verts[idx[:, 1]], verts[idx[:, 2]]
    fn = np.cross(b - a, c - a)
    out = np.zeros_like(verts)
    for i in range(3):
        for ax in range(3):
            out[:, ax] += np.bincount(idx[:, i], weights=fn[:, ax], minlength=len(verts))
    ln = np.linalg.norm(out, axis=1)
    ln[ln == 0] = 1
    return out / ln[:, None]


def to_game_axes(verts, centre_y):
    """STL (x, y fore-aft, z up) -> game (x, y up, z with the bow at -Z)."""
    out = np.empty_like(verts)
    out[:, 0] = verts[:, 0]
    out[:, 1] = verts[:, 2] - WATERLINE
    out[:, 2] = -(verts[:, 1] - centre_y)
    return out


def write_glb(path, parts):
    buf = bytearray()
    accessors, views, meshes, nodes, materials = [], [], [], [], []
    for name, verts, idx in parts:
        verts = verts.astype(np.float32)
        norm = normals(verts.astype(np.float64), idx).astype(np.float32)
        idx = idx.astype(np.uint32)
        chunk = []
        for data, kind, comp, count, mn, mx in (
            (verts, 'VEC3', 5126, len(verts), verts.min(0).tolist(), verts.max(0).tolist()),
            (norm, 'VEC3', 5126, len(norm), None, None),
            (idx.ravel(), 'SCALAR', 5125, idx.size, None, None),
        ):
            raw = data.tobytes()
            while len(buf) % 4:
                buf += b'\x00'
            views.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(raw)})
            acc = {'bufferView': len(views) - 1, 'componentType': comp, 'count': count, 'type': kind}
            if mn is not None:
                acc['min'], acc['max'] = mn, mx
            accessors.append(acc)
            chunk.append(len(accessors) - 1)
            buf += raw
        materials.append({'pbrMetallicRoughness': {'baseColorFactor': [0.8, 0.8, 0.8, 1.0],
                                                   'metallicFactor': 0.0, 'roughnessFactor': 0.9},
                          'name': name})
        meshes.append({'name': name, 'primitives': [{
            'attributes': {'POSITION': chunk[0], 'NORMAL': chunk[1]},
            'indices': chunk[2], 'material': len(materials) - 1, 'mode': 4}]})
        nodes.append({'mesh': len(meshes) - 1, 'name': name})

    gltf = {'asset': {'version': '2.0', 'generator': 'stl_to_glb.py'},
            'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
            'nodes': nodes, 'meshes': meshes, 'materials': materials,
            'accessors': accessors, 'bufferViews': views,
            'buffers': [{'byteLength': len(buf)}]}

    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    buf += b'\x00' * ((-len(buf)) % 4)
    out = bytearray(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(buf)))
    out += struct.pack('<I', len(js)) + b'JSON' + js
    out += struct.pack('<I', len(buf)) + b'BIN\x00' + bytes(buf)
    open(path, 'wb').write(out)
    return len(out)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    cell = float(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_CELL

    tris = load_stl(src)
    print(f'loaded {len(tris)} triangles')

    tris = tris[tris[:, :, 2].max(1) >= BASE_Z]          # drop the print raft
    cen = tris.mean(1)
    rig = cen[:, 2] >= RIG_Z
    thin = np.abs(tris[:, :, 0]).max(1) <= SAIL_X
    groups = {'hull': tris[~rig], 'sails': tris[rig & thin], 'spars': tris[rig & ~thin]}

    centre_y = float(np.concatenate([g[:, :, 1].ravel() for g in groups.values()]).mean())
    parts = []
    for name, g in groups.items():
        if not len(g):
            continue
        verts, idx = cluster(g, cell) if name == 'hull' else weld(g)
        parts.append((name, to_game_axes(verts, centre_y), idx))
        print(f'  {name:6s} {len(g):7d} -> {len(idx):6d} tris, {len(verts):6d} verts')

    size = write_glb(dst, parts)
    print(f'wrote {dst}: {size/1048576:.2f} MB')


if __name__ == '__main__':
    main()
