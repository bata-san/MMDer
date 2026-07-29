#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import math
import posixpath
import struct
import sys
import zipfile
from array import array
from dataclasses import dataclass
from pathlib import Path

GLTF_COMPONENT_FLOAT = 5126
GLTF_COMPONENT_UNSIGNED_SHORT = 5123
GLTF_COMPONENT_UNSIGNED_INT = 5125
GLTF_TARGET_ARRAY_BUFFER = 34962
GLTF_TARGET_ELEMENT_ARRAY_BUFFER = 34963


def decode_zip_name(info: zipfile.ZipInfo) -> str:
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode('cp437').decode('cp932')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename


def normalize_path(value: str) -> str:
    value = value.replace('\\', '/').lstrip('/')
    normalized = posixpath.normpath(value)
    if normalized == '.':
        return ''
    if normalized == '..' or normalized.startswith('../'):
        raise ValueError(f'Unsafe archive path: {value}')
    return normalized


class Reader:
    def __init__(self, data: bytes):
        self.data = memoryview(data)
        self.offset = 0

    def read(self, size: int) -> bytes:
        end = self.offset + size
        if end > len(self.data):
            raise EOFError(f'Unexpected end of PMX at {self.offset}, need {size} bytes')
        out = self.data[self.offset:end].tobytes()
        self.offset = end
        return out

    def unpack(self, fmt: str):
        size = struct.calcsize('<' + fmt)
        values = struct.unpack('<' + fmt, self.read(size))
        return values[0] if len(values) == 1 else values

    def index(self, size: int, signed: bool) -> int:
        formats = {
            (1, False): 'B', (2, False): 'H', (4, False): 'I',
            (1, True): 'b', (2, True): 'h', (4, True): 'i',
        }
        return int(self.unpack(formats[(size, signed)]))


@dataclass
class PmxHeader:
    encoding: str
    additional_uv: int
    vertex_index_size: int
    texture_index_size: int
    material_index_size: int
    bone_index_size: int
    morph_index_size: int
    rigid_index_size: int


@dataclass
class Material:
    name: str
    diffuse: tuple[float, float, float, float]
    flags: int
    texture_index: int
    surface_count: int


@dataclass
class PmxStatic:
    name: str
    positions: array
    normals: array
    uvs: array
    indices: list[int]
    textures: list[str]
    materials: list[Material]
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]


def read_text(reader: Reader, encoding: str) -> str:
    length = int(reader.unpack('i'))
    if length < 0:
        raise ValueError(f'Negative PMX string length: {length}')
    return reader.read(length).decode(encoding, errors='replace')


def parse_pmx(data: bytes) -> PmxStatic:
    reader = Reader(data)
    if reader.read(4) != b'PMX ':
        raise ValueError('Background source is not a PMX file')
    version = float(reader.unpack('f'))
    if not (1.9 <= version <= 2.2):
        raise ValueError(f'Unsupported PMX version: {version}')
    header_size = int(reader.unpack('B'))
    raw = reader.read(header_size)
    if len(raw) < 8:
        raise ValueError('Invalid PMX global header')
    encoding = 'utf-16-le' if raw[0] == 0 else 'utf-8'
    header = PmxHeader(
        encoding=encoding,
        additional_uv=raw[1],
        vertex_index_size=raw[2],
        texture_index_size=raw[3],
        material_index_size=raw[4],
        bone_index_size=raw[5],
        morph_index_size=raw[6],
        rigid_index_size=raw[7],
    )
    model_name = read_text(reader, encoding)
    read_text(reader, encoding)
    read_text(reader, encoding)
    read_text(reader, encoding)

    vertex_count = int(reader.unpack('i'))
    if vertex_count <= 0:
        raise ValueError('PMX contains no vertices')

    positions = array('f')
    normals = array('f')
    uvs = array('f')
    min_x = min_y = min_z = math.inf
    max_x = max_y = max_z = -math.inf

    for _ in range(vertex_count):
        x, y, z = reader.unpack('3f')
        nx, ny, nz = reader.unpack('3f')
        u, v = reader.unpack('2f')
        if header.additional_uv:
            reader.read(header.additional_uv * 16)
        deform = int(reader.unpack('B'))
        if deform == 0:
            reader.index(header.bone_index_size, True)
        elif deform == 1:
            reader.index(header.bone_index_size, True)
            reader.index(header.bone_index_size, True)
            reader.read(4)
        elif deform in (2, 4):
            reader.read(header.bone_index_size * 4 + 16)
        elif deform == 3:
            reader.read(header.bone_index_size * 2 + 4 + 36)
        else:
            raise ValueError(f'Unsupported PMX deform type: {deform}')
        reader.read(4)

        z = -z
        nz = -nz
        positions.extend((x, y, z))
        normals.extend((nx, ny, nz))
        uvs.extend((u, 1.0 - v))
        min_x, min_y, min_z = min(min_x, x), min(min_y, y), min(min_z, z)
        max_x, max_y, max_z = max(max_x, x), max(max_y, y), max(max_z, z)

    index_count = int(reader.unpack('i'))
    raw_indices = [reader.index(header.vertex_index_size, False) for _ in range(index_count)]
    if index_count % 3:
        raise ValueError(f'PMX index count is not triangular: {index_count}')
    indices: list[int] = []
    for index in range(0, index_count, 3):
        a, b, c = raw_indices[index:index + 3]
        indices.extend((a, c, b))

    texture_count = int(reader.unpack('i'))
    textures = [read_text(reader, encoding) for _ in range(texture_count)]

    material_count = int(reader.unpack('i'))
    materials: list[Material] = []
    for material_index in range(material_count):
        name = read_text(reader, encoding) or f'Material {material_index + 1}'
        read_text(reader, encoding)
        diffuse = tuple(float(value) for value in reader.unpack('4f'))
        reader.read(12)
        reader.read(4)
        reader.read(12)
        flags = int(reader.unpack('B'))
        reader.read(16)
        reader.read(4)
        texture_index = reader.index(header.texture_index_size, True)
        reader.index(header.texture_index_size, True)
        reader.read(1)
        toon_shared = int(reader.unpack('B'))
        if toon_shared == 0:
            reader.index(header.texture_index_size, True)
        else:
            reader.read(1)
        read_text(reader, encoding)
        surface_count = int(reader.unpack('i'))
        materials.append(Material(name, diffuse, flags, texture_index, surface_count))

    if sum(item.surface_count for item in materials) != len(indices):
        raise ValueError('PMX material surface ranges do not match the index buffer')

    return PmxStatic(
        name=model_name,
        positions=positions,
        normals=normals,
        uvs=uvs,
        indices=indices,
        textures=textures,
        materials=materials,
        bounds_min=(min_x, min_y, min_z),
        bounds_max=(max_x, max_y, max_z),
    )


def png_has_alpha(data: bytes) -> bool:
    return len(data) > 26 and data[:8] == b'\x89PNG\r\n\x1a\n' and data[25] in (4, 6)


def mime_for(path: str, data: bytes) -> str | None:
    suffix = Path(path).suffix.lower()
    if suffix == '.png' and data.startswith(b'\x89PNG'):
        return 'image/png'
    if suffix in ('.jpg', '.jpeg') and data.startswith(b'\xff\xd8'):
        return 'image/jpeg'
    if suffix == '.webp' and data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        return 'image/webp'
    return None


class GlbBuilder:
    def __init__(self):
        self.binary = bytearray()
        self.buffer_views: list[dict] = []
        self.accessors: list[dict] = []

    def align(self, alignment: int = 4) -> None:
        while len(self.binary) % alignment:
            self.binary.append(0)

    def add_view(self, payload: bytes, *, target: int | None = None) -> int:
        self.align(4)
        offset = len(self.binary)
        self.binary.extend(payload)
        view: dict = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)}
        if target is not None:
            view['target'] = target
        self.buffer_views.append(view)
        return len(self.buffer_views) - 1

    def add_accessor(self, view: int, component_type: int, count: int, kind: str,
                     *, minimum: tuple[float, ...] | None = None,
                     maximum: tuple[float, ...] | None = None) -> int:
        accessor: dict = {
            'bufferView': view,
            'componentType': component_type,
            'count': count,
            'type': kind,
        }
        if minimum is not None:
            accessor['min'] = list(minimum)
        if maximum is not None:
            accessor['max'] = list(maximum)
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def build_glb(pmx: PmxStatic, pmx_path: str, archive: dict[str, bytes]) -> bytes:
    builder = GlbBuilder()
    vertex_count = len(pmx.positions) // 3

    position_view = builder.add_view(pmx.positions.tobytes(), target=GLTF_TARGET_ARRAY_BUFFER)
    normal_view = builder.add_view(pmx.normals.tobytes(), target=GLTF_TARGET_ARRAY_BUFFER)
    uv_view = builder.add_view(pmx.uvs.tobytes(), target=GLTF_TARGET_ARRAY_BUFFER)
    position_accessor = builder.add_accessor(
        position_view,
        GLTF_COMPONENT_FLOAT,
        vertex_count,
        'VEC3',
        minimum=pmx.bounds_min,
        maximum=pmx.bounds_max,
    )
    normal_accessor = builder.add_accessor(normal_view, GLTF_COMPONENT_FLOAT, vertex_count, 'VEC3')
    uv_accessor = builder.add_accessor(uv_view, GLTF_COMPONENT_FLOAT, vertex_count, 'VEC2')

    archive_lower = {key.lower(): key for key in archive}
    basename_lookup: dict[str, list[str]] = {}
    for path in archive:
        basename_lookup.setdefault(posixpath.basename(path).lower(), []).append(path)
    pmx_dir = posixpath.dirname(pmx_path)

    images: list[dict] = []
    textures: list[dict] = []
    texture_cache: dict[int, tuple[int, bool] | None] = {}

    def resolve_texture(texture_index: int) -> tuple[int, bool] | None:
        if texture_index in texture_cache:
            return texture_cache[texture_index]
        if texture_index < 0 or texture_index >= len(pmx.textures):
            texture_cache[texture_index] = None
            return None
        reference = normalize_path(pmx.textures[texture_index])
        candidate = normalize_path(posixpath.join(pmx_dir, reference))
        actual = archive_lower.get(candidate.lower())
        if actual is None:
            matches = basename_lookup.get(posixpath.basename(reference).lower(), [])
            actual = matches[0] if len(matches) == 1 else None
        if actual is None:
            print(f'[background] texture not found: {pmx.textures[texture_index]}', file=sys.stderr)
            texture_cache[texture_index] = None
            return None
        payload = archive[actual]
        mime = mime_for(actual, payload)
        if mime is None:
            print(f'[background] unsupported texture skipped: {actual}', file=sys.stderr)
            texture_cache[texture_index] = None
            return None
        image_view = builder.add_view(payload)
        image_index = len(images)
        images.append({'bufferView': image_view, 'mimeType': mime, 'name': posixpath.basename(actual)})
        gltf_texture_index = len(textures)
        textures.append({'sampler': 0, 'source': image_index})
        alpha = mime == 'image/png' and png_has_alpha(payload)
        texture_cache[texture_index] = (gltf_texture_index, alpha)
        return texture_cache[texture_index]

    gltf_materials: list[dict] = []
    primitives: list[dict] = []
    index_cursor = 0
    max_index = max(pmx.indices, default=0)
    index_component = GLTF_COMPONENT_UNSIGNED_SHORT if max_index <= 65535 else GLTF_COMPONENT_UNSIGNED_INT
    index_code = 'H' if index_component == GLTF_COMPONENT_UNSIGNED_SHORT else 'I'

    for item in pmx.materials:
        texture_info = resolve_texture(item.texture_index)
        red, green, blue, alpha = item.diffuse
        pbr: dict = {
            'baseColorFactor': [
                max(0.0, min(1.0, red)),
                max(0.0, min(1.0, green)),
                max(0.0, min(1.0, blue)),
                max(0.0, min(1.0, alpha)),
            ],
            'metallicFactor': 0.0,
            'roughnessFactor': 0.82,
        }
        texture_has_alpha = False
        if texture_info is not None:
            gltf_texture_index, texture_has_alpha = texture_info
            pbr['baseColorTexture'] = {'index': gltf_texture_index}
        material: dict = {
            'name': item.name,
            'pbrMetallicRoughness': pbr,
            'doubleSided': bool(item.flags & 0x01),
        }
        if alpha < 0.999 or texture_has_alpha:
            material['alphaMode'] = 'BLEND'
        gltf_materials.append(material)

        material_indices = pmx.indices[index_cursor:index_cursor + item.surface_count]
        index_cursor += item.surface_count
        if not material_indices:
            continue
        packed = array(index_code, material_indices).tobytes()
        view = builder.add_view(packed, target=GLTF_TARGET_ELEMENT_ARRAY_BUFFER)
        accessor = builder.add_accessor(view, index_component, len(material_indices), 'SCALAR')
        primitives.append({
            'attributes': {
                'POSITION': position_accessor,
                'NORMAL': normal_accessor,
                'TEXCOORD_0': uv_accessor,
            },
            'indices': accessor,
            'material': len(gltf_materials) - 1,
            'mode': 4,
        })

    gltf: dict = {
        'asset': {'version': '2.0', 'generator': 'MMD LAB static PMX background baker'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': pmx.name or 'Built-in background'}],
        'meshes': [{'name': pmx.name or 'Built-in background', 'primitives': primitives}],
        'buffers': [{'byteLength': len(builder.binary)}],
        'bufferViews': builder.buffer_views,
        'accessors': builder.accessors,
        'materials': gltf_materials,
    }
    if images:
        gltf['images'] = images
        gltf['textures'] = textures
        gltf['samplers'] = [{
            'magFilter': 9729,
            'minFilter': 9987,
            'wrapS': 10497,
            'wrapT': 10497,
        }]

    json_bytes = json.dumps(gltf, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4:
        json_bytes += b' '
    builder.align(4)
    bin_bytes = bytes(builder.binary)
    while len(bin_bytes) % 4:
        bin_bytes += b'\x00'

    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    return b''.join((
        struct.pack('<4sII', b'glTF', 2, total_length),
        struct.pack('<I4s', len(json_bytes), b'JSON'),
        json_bytes,
        struct.pack('<I4s', len(bin_bytes), b'BIN\x00'),
        bin_bytes,
    ))


def load_archive(source: Path) -> tuple[str, bytes, dict[str, bytes]]:
    with zipfile.ZipFile(source) as archive_file:
        decoded: dict[str, zipfile.ZipInfo] = {}
        for info in archive_file.infolist():
            path = normalize_path(decode_zip_name(info))
            if path and not path.endswith('/'):
                decoded[path] = info
        pmx_candidates = [path for path in decoded if posixpath.basename(path) == 'シャーレオフィス.pmx']
        if not pmx_candidates:
            pmx_candidates = [path for path in decoded if path.lower().endswith('.pmx')]
        if not pmx_candidates:
            raise FileNotFoundError('No PMX background was found in the source ZIP')
        pmx_path = max(pmx_candidates, key=lambda path: decoded[path].file_size)
        archive = {path: archive_file.read(info) for path, info in decoded.items()}
        return pmx_path, archive[pmx_path], archive


def write_module(output: Path, glb: bytes, name: str) -> None:
    compressed = gzip.compress(glb, compresslevel=9, mtime=0)
    encoded = base64.b64encode(compressed).decode('ascii')
    chunks = [encoded[index:index + 16384] for index in range(0, len(encoded), 16384)]
    sha256 = hashlib.sha256(glb).hexdigest()
    lines = [
        '// Generated by scripts/build-background.py. Do not commit this private asset.\n',
        f'export const BACKGROUND_NAME = {json.dumps(name, ensure_ascii=False)};\n',
        f'export const BACKGROUND_SHA256 = {json.dumps(sha256)};\n',
        f'export const BACKGROUND_UNCOMPRESSED_BYTES = {len(glb)};\n',
        'export const BACKGROUND_GZIP_BASE64_CHUNKS = [\n',
    ]
    lines.extend(f'  {json.dumps(chunk)},\n' for chunk in chunks)
    lines.append('] as const;\n')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(''.join(lines), encoding='utf-8')
    print(f'[background] GLB: {len(glb):,} bytes')
    print(f'[background] gzip: {len(compressed):,} bytes')
    print(f'[background] module: {output}')
    print(f'[background] sha256: {sha256}')


def main() -> None:
    parser = argparse.ArgumentParser(description='Bake a private PMX background ZIP into an embedded GLB module.')
    parser.add_argument('--source', type=Path, default=Path('private/blender&MMD.zip'))
    parser.add_argument('--output', type=Path, default=Path('private/background-data.ts'))
    parser.add_argument('--glb', type=Path, default=None, help='Optional debug GLB output path.')
    args = parser.parse_args()

    if not args.source.is_file():
        raise FileNotFoundError(f'Background source ZIP not found: {args.source}')
    pmx_path, pmx_bytes, archive = load_archive(args.source)
    print(f'[background] source model: {pmx_path}')
    pmx = parse_pmx(pmx_bytes)
    print(f'[background] vertices: {len(pmx.positions) // 3:,}')
    print(f'[background] triangles: {len(pmx.indices) // 3:,}')
    print(f'[background] materials: {len(pmx.materials):,}')
    glb = build_glb(pmx, pmx_path, archive)
    if args.glb:
        args.glb.parent.mkdir(parents=True, exist_ok=True)
        args.glb.write_bytes(glb)
    write_module(args.output, glb, pmx.name or Path(pmx_path).stem)


if __name__ == '__main__':
    main()
