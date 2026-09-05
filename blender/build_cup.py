"""
Blender headless builder for the Render cup.

Usage:
    Blender -b -y --python blender/build_cup.py -- --clay stone
    Blender -b -y --python blender/build_cup.py -- --clay asphalt

The script:
  1. builds the cup mesh in Blender (print layers + round medallion relief);
  2. paints body colour / clearcoat / roughness maps for that clay;
  3. exports a GLB that Three.js loads in the web app.
"""

import argparse
import math
import os
import struct
import sys
import zlib
from pathlib import Path

import bpy

# ---------------------------------------------------------------------------
# Fixed product dimensions (millimetres; exported with a 0.001 scale).
# ---------------------------------------------------------------------------

H = 86.0       # cup height
D = 74.0       # cup diameter
T = 1.5        # wall thickness
B = 5.0        # bottom thickness
LH = 1.0       # printed layer height

PROFILE = [
    (0.0, 1.0),
    (1.0, 1.0),
]

MEDALLION_ANGLE = 1.075
MEDALLION_COUNT = 5
MEDALLION_Y_FRAC = 0.56
MEDALLION_RADIUS = 14.0
MEDALLION_HEIGHT = 1.0

CLAYS = {
    "stone": {"name": "Stone", "rgb": (181, 170, 151)},
    "asphalt": {"name": "Asphalt", "rgb": (52, 53, 54)},
}

TEX_W = 1024
TEX_H = 512


def parse_args():
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser()
    p.add_argument("--clay", default="stone")
    return p.parse_args(argv)


def smooth01(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def profile_radius(t):
    t = min(1.0, max(0.0, t))
    for i in range(1, len(PROFILE)):
        y0, r0 = PROFILE[i - 1]
        y1, r1 = PROFILE[i]
        if t <= y1:
            k = smooth01((t - y0) / max(1e-6, y1 - y0))
            return r0 + (r1 - r0) * k
    return PROFILE[-1][1]


def hash_noise(n):
    s = math.sin(n * 12.9898 + 78.233) * 43758.5453
    return s - math.floor(s)


def angle_delta(a, b):
    d = a - b
    while d > math.pi:
        d -= math.pi * 2
    while d < -math.pi:
        d += math.pi * 2
    return d


def medallion_coverage(angle, y, surface_r):
    delta = 10.0
    step = math.pi * 2 / MEDALLION_COUNT
    for i in range(MEDALLION_COUNT):
        center = MEDALLION_ANGLE + i * step
        d = abs(angle_delta(angle, center))
        delta = min(delta, d)
    arc = delta * surface_r
    dy = y - H * MEDALLION_Y_FRAC
    distance = math.hypot(arc, dy)
    t = distance / MEDALLION_RADIUS
    if t <= 0.72:
        return 1.0
    if t >= 1.0:
        return 0.0
    q = (t - 0.72) / 0.28
    return 1.0 - q * q * (3 - 2 * q)


def layer_offset(y):
    phase = y / LH - 0.5
    d = phase - round(phase)
    ridge = 0.5 + 0.5 * math.cos(math.pi * 2 * d)
    loop = round(y / LH)
    wobble = 1 + (hash_noise(loop * 1.731) - 0.5) * 0.34
    amp = 0.052 + LH * 0.062
    micro = 0.022 * math.sin(loop * 1.3) * ridge
    return amp * ridge * wobble + micro


def outer_radius(angle, y, include_medallion=True):
    r = D / 2 * profile_radius(y / H)
    low = 0.018 * math.sin(y / H * 6.7 + math.sin(angle * 3 + 1.2) * 1.4)
    off = layer_offset(y) + low
    if include_medallion:
        cov = medallion_coverage(angle, y, r)
        if cov > 0:
            off += MEDALLION_HEIGHT * cov
    return max(0.5, r + off)


def inner_radius(angle, y):
    r = D / 2 * profile_radius(y / H) - T
    off = layer_offset(y) * 0.52
    return max(0.5, r - off)


# ---------------------------------------------------------------------------
# Tiny PNG encoder (Blender's Python has no external imaging library).
# ---------------------------------------------------------------------------

def png_chunk(tag, data):
    out = struct.pack(">I", len(data)) + tag + data
    out += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return out


def write_png(path, w, h, get_pixel):
    raw = bytearray()
    for py in range(h):
        raw.append(0)
        for px in range(w):
            raw.extend(bytes(get_pixel(px, py)))
    png = b"\x89PNG\r\n\x1a\n"
    png += png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += png_chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def pnoise(u, v, seed=0):
    return (
        math.sin(u * 6.2831 * 5 + seed) * 0.5
        + math.sin(u * 6.2831 * 13 + v * 2.1 + seed * 1.7) * 0.28
        + math.sin((u + v * 0.37) * 6.2831 * 29 + seed * 3.1) * 0.12
        + math.sin(v * 6.2831 * 2.3 + seed * 2.2) * 0.1
    )


def rand(u, v, seed=0):
    s = math.sin(u * 127.1 + v * 311.7 + seed * 74.7) * 43758.5453
    return s - math.floor(s)


def clay_speckle(u, v, clay_rgb):
    r, g, b = clay_rgb
    # Delicate, slightly mottled fired clay. A tiny periodic term follows the
    # printed layer pitch so adjacent rows differ a hair, plus low-frequency
    # mineral variation. No hard pixel speckles.
    layer = 0.006 * math.sin(v * (H / LH) * math.pi * 2 + 1.7)
    grain = layer + pnoise(u, v, 13) * 0.012 + pnoise(u * 3.1, v * 4.2, 7) * 0.009
    f = min(1.05, max(0.95, 1 + grain))
    return (r * f, g * f, b * f)


def wet_clay(u, v, clay_rgb, amount=0.72, saturation=1.38):
    r, g, b = clay_speckle(u, v, clay_rgb)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mottle = 1 + pnoise(u * 2.4, v * 3.1, 31) * 0.055
    k = amount * mottle
    return (
        (lum + (r - lum) * saturation) * k,
        (lum + (g - lum) * saturation) * k,
        (lum + (b - lum) * saturation) * k,
    )


def glazed_clay(u, v, clay_rgb):
    """Clay as it reads under clear glaze: noticeably darker and richer,
    independent of how much light hits it."""
    return wet_clay(u, v, clay_rgb, amount=0.5, saturation=1.5)


def clamp255(v):
    return max(0, min(255, round(v)))


def glaze_cover(u, y, H_):
    r = D / 2 * profile_radius(y / H_)
    # Glaze covers the exterior medallion and wraps ~1 mm over the top rim.
    top = 1 if y > H_ - 1.0 else 0
    return max(top, medallion_coverage(u * math.pi * 2, y, r))


def build_body_textures(clay_id, out_dir):
    rgb = CLAYS[clay_id]["rgb"]
    color_rows = []
    rough_rows = []
    coat_rows = []
    for py in range(TEX_H):
        v = 1 - (py + 0.5) / TEX_H
        y = v * H
        row_color = bytearray()
        row_rough = bytearray()
        row_coat = bytearray()
        for px in range(TEX_W):
            u = (px + 0.5) / TEX_W
            g = glaze_cover(u, y, H)
            # Base colour is the same clay everywhere. Glaze differs only in
            # roughness + clearcoat, never through a separate dark paint layer.
            c = clay_speckle(u, v, rgb)
            raw_rough = 0.8 + pnoise(u, v, 21) * 0.02
            glass_rough = 0.2 + pnoise(u, v, 37) * 0.02
            rough = raw_rough * (1 - g) + glass_rough * g
            row_color += bytes((clamp255(c[0]), clamp255(c[1]), clamp255(c[2]), 255))
            row_rough += bytes((clamp255(rough * 255),) * 4)
            row_coat += bytes((clamp255(g * 255),) * 4)
        color_rows.append(bytes(row_color))
        rough_rows.append(bytes(row_rough))
        coat_rows.append(bytes(row_coat))

    def getter(rows):
        return lambda px, py: rows[py][px * 4 : px * 4 + 4]

    write_png(out_dir / f"body-color-{clay_id}.png", TEX_W, TEX_H, getter(color_rows))
    write_png(out_dir / f"body-rough-{clay_id}.png", TEX_W, TEX_H, getter(rough_rows))
    write_png(out_dir / f"body-coat-{clay_id}.png", TEX_W, TEX_H, getter(coat_rows))


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------

def make_mesh(name, verts, faces, uv_by_vertex):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            uv.data[li].uv = uv_by_vertex[vi]
    mesh.shade_smooth()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    return ob


def orient_face(verts, face, outward):
    def normal(face_pts):
        a = verts[face_pts[0]]
        b = verts[face_pts[1]]
        c = verts[face_pts[2]]
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        return (
            uy * vz - uz * vy,
            uz * vx - ux * vz,
            ux * vy - uy * vx,
        )

    n = normal(face)
    dot = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2]
    return list(face) if dot >= 0 else list(reversed(face))


def ring_rows(inner):
    n = max(90, math.ceil(H / LH) * 5)
    rows = [H * i / n for i in range(n + 1)]
    if inner and not any(abs(r - B) < 1e-3 for r in rows):
        rows.append(B)
        rows.sort()
    return [r for r in rows if (not inner or r >= B - 1e-5)]


def lathe_surface(name, inner):
    A = 160
    rows = ring_rows(inner)
    verts = []
    uv_by_vertex = []
    row_start = []
    for y in rows:
        row_start.append(len(verts))
        for j in range(A):
            angle = j / A * math.pi * 2
            if inner:
                r = inner_radius(angle, y)
                vv = (y - B) / (H - B)
            else:
                r = outer_radius(angle, y)
                vv = y / H
            verts.append((r * math.cos(angle), r * math.sin(angle), y))
            uv_by_vertex.append((j / A, vv))

    faces = []
    for ri in range(len(rows) - 1):
        for j in range(A):
            jn = (j + 1) % A
            a = row_start[ri] + j
            b = row_start[ri + 1] + j
            c = row_start[ri + 1] + jn
            d = row_start[ri] + jn
            p0 = verts[a]
            rmag = math.hypot(p0[0], p0[1]) or 1
            outward = (
                (-p0[0] if inner else p0[0]) / rmag,
                (-p0[1] if inner else p0[1]) / rmag,
                0.0,
            )
            faces.append(orient_face(verts, [a, b, c, d], outward))
    return make_mesh(name, verts, faces, uv_by_vertex)


def cap_mesh(name, y, radius, outward, top_uv_v):
    A = 160
    center = (0, 0, y)
    verts = [center]
    uv_by_vertex = [(0.5, top_uv_v)]
    for i in range(A):
        angle = i / A * math.pi * 2
        verts.append((radius * math.cos(angle), radius * math.sin(angle), y))
        uv_by_vertex.append((i / A, top_uv_v))
    faces = []
    for i in range(1, A - 1):
        f = orient_face(verts, [0, i + 1, i], outward)
        faces.append(f)
    return make_mesh(name, verts, faces, uv_by_vertex)


def rim_cap(name, body_mat):
    A = 160
    r_out = D / 2 * profile_radius(1.0)
    r_in = max(0.5, r_out - T)
    verts = []
    uv_by_vertex = []
    for r in (r_out, r_in):
        for i in range(A):
            angle = i / A * math.pi * 2
            verts.append((r * math.cos(angle), r * math.sin(angle), H))
            uv_by_vertex.append((i / A, 1.0))
    faces = []
    for i in range(A):
        ni = (i + 1) % A
        f = orient_face(verts, [i, A + i, A + ni, ni], (0, 0, 1))
        faces.append(f)
    ob = make_mesh(name, verts, faces, uv_by_vertex)
    ob.data.materials.append(body_mat)
    return ob


def handle(name, glaze_mat):
    # Full torus loop in the x-z plane, sitting outside the +x wall.
    gap = 2.5
    tube_r = 7.0
    major = 27.0
    cx = D / 2 + gap + tube_r + major
    cy = H * 0.5
    M = 160
    S = 32
    verts = []
    for i in range(M):
        phi = i / M * math.pi * 2
        center = (cx + major * math.cos(phi), 0.0, cy + major * math.sin(phi))
        t = (-math.sin(phi), 0.0, math.cos(phi))
        b1 = (0.0, 1.0, 0.0)
        b2 = (-t[2], 0.0, t[0])
        # Faint printed segmentation along the handle loop (~1 mm pitch).
        ridge = 1 + 0.035 * (0.5 + 0.5 * math.cos(major * phi / LH))
        for j in range(S):
            psi = j / S * math.pi * 2
            tube = tube_r * ridge
            offset = (
                b1[0] * tube * math.cos(psi) + b2[0] * tube * math.sin(psi),
                b1[1] * tube * math.cos(psi) + b2[1] * tube * math.sin(psi),
                b1[2] * tube * math.cos(psi) + b2[2] * tube * math.sin(psi),
            )
            verts.append((center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]))

    faces = []
    for i in range(M):
        ni = (i + 1) % M
        for j in range(S):
            nj = (j + 1) % S
            a = i * S + j
            b = ni * S + j
            c = ni * S + nj
            d = i * S + nj
            centerline = (cx + major * math.cos((i + 0.5) / M * math.pi * 2), 0, cy + major * math.sin((i + 0.5) / M * math.pi * 2))
            mid = verts[a]
            outward = (mid[0] - centerline[0], mid[1] - centerline[1], mid[2] - centerline[2])
            faces.append(orient_face(verts, [a, b, c, d], outward))

    uv_by_vertex = [(0.0, 0.0)] * len(verts)
    ob = make_mesh(name, verts, faces, uv_by_vertex)
    ob.rotation_euler = (0, 0, -0.92)
    ob.data.materials.append(glaze_mat)
    return ob


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def image_node(mat, path, colorspace="sRGB", x=0, y=0):
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = colorspace
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.location = (x, y)
    return node


def principled(mat):
    return mat.node_tree.nodes["Principled BSDF"]


def body_material(name, tex_dir, clay_id):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    p = principled(mat)
    tree.nodes.remove(p)
    p = tree.nodes.new("ShaderNodeBsdfPrincipled")
    out = tree.nodes["Material Output"]
    tree.links.new(p.outputs["BSDF"], out.inputs["Surface"])

    color = image_node(mat, tex_dir / f"body-color-{clay_id}.png", "sRGB", -900, 400)
    rough = image_node(mat, tex_dir / f"body-rough-{clay_id}.png", "Non-Color", -900, 100)
    coat = image_node(mat, tex_dir / f"body-coat-{clay_id}.png", "Non-Color", -900, -200)
    tree.links.new(color.outputs["Color"], p.inputs["Base Color"])
    tree.links.new(rough.outputs["Color"], p.inputs["Roughness"])
    tree.links.new(coat.outputs["Color"], p.inputs["Coat Weight"])
    p.inputs["Coat Roughness"].default_value = 0.08
    mat.diffuse_color = (0.7, 0.7, 0.7, 1)
    return mat


def glaze_material(name, clay_rgb, glaze_color_path):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = principled(mat)
    color = image_node(mat, glaze_color_path, "sRGB", -600, 300)
    mat.node_tree.links.new(color.outputs["Color"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.2
    p.inputs["Coat Weight"].default_value = 1.0
    p.inputs["Coat Roughness"].default_value = 0.1
    p.inputs["IOR"].default_value = 1.45
    return mat


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)


def main():
    args = parse_args()
    if args.clay not in CLAYS:
        raise SystemExit(f"Unknown clay {args.clay}")
    root = Path(__file__).resolve().parents[1]
    tex_dir = root / "public" / "textures"
    model_dir = root / "public" / "models"
    tex_dir.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)

    build_body_textures(args.clay, tex_dir)
    clear_scene()

    body_mat = body_material(f"body-{args.clay}", tex_dir, args.clay)
    glaze_mat = glaze_material(
        f"glaze-{args.clay}",
        CLAYS[args.clay]["rgb"],
        tex_dir / f"body-color-{args.clay}.png",
    )

    outer = lathe_surface("outer-wall", inner=False)
    outer.data.materials.append(body_mat)

    inner = lathe_surface("inner-wall", inner=True)
    inner.data.materials.append(glaze_mat)

    bottom = cap_mesh("bottom", 0.0, D / 2 * profile_radius(0), (0, 0, -1), 0.0)
    bottom.data.materials.append(body_mat)

    floor = cap_mesh("interior-floor", B, max(0.5, D / 2 * profile_radius(B / H) - T), (0, 0, 1), 0.0)
    floor.data.materials.append(glaze_mat)

    rim_cap("rim-cap", body_mat)

    # Blender is unit-neutral here; the mesh was authored in millimetres, so
    # bring it down to GLTF metres and bake the transform into the mesh.
    for ob in bpy.data.objects:
        ob.scale = (0.001, 0.001, 0.001)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    glb = model_dir / f"cup-{args.clay}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        export_materials="EXPORT",
        export_apply=True,
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
    )
    print(f"BLENDER_BUILD_OK {glb.name}")


if __name__ == "__main__":
    main()
