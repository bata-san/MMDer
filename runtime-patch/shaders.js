export const COMPUTE_WGSL = /* wgsl */`
struct BaseVertex { position: vec4f, normal: vec4f, uv: vec4f }
struct SkinVertex { bones: vec4u, weights: vec4f, c: vec4f, r0: vec4f, r1: vec4f, skinKind: vec4u }
struct Params { vertexCount: u32, morphCount: u32, _a: u32, _b: u32 }
@group(0) @binding(0) var<storage, read> baseVertices: array<BaseVertex>;
@group(0) @binding(1) var<storage, read> skinVertices: array<SkinVertex>;
@group(0) @binding(2) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(3) var<storage, read> morphRanges: array<vec4u>;
@group(0) @binding(4) var<storage, read> morphContributions: array<vec4f>;
@group(0) @binding(5) var<storage, read> morphWeights: array<f32>;
@group(0) @binding(6) var<storage, read_write> outputVertices: array<BaseVertex>;
@group(0) @binding(7) var<uniform> params: Params;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= params.vertexCount) { return; }
  let base = baseVertices[index];
  let skin = skinVertices[index];
  let ranges = morphRanges[index];
  var p = base.position.xyz;
  var uv = base.uv.xy;
  for (var i = 0u; i < ranges.y; i += 1u) {
    let c = morphContributions[ranges.x + i];
    let mi = u32(c.w + 0.5);
    if (mi < params.morphCount) { p += c.xyz * morphWeights[mi]; }
  }
  for (var i = 0u; i < ranges.w; i += 1u) {
    let c = morphContributions[ranges.z + i];
    let mi = u32(c.w + 0.5);
    if (mi < params.morphCount) { uv += c.xy * morphWeights[mi]; }
  }

  var outP = vec3f(0.0);
  var outN = vec3f(0.0);
  let hp = vec4f(p, 1.0);
  let hn = vec4f(base.normal.xyz, 0.0);
  for (var j = 0u; j < 4u; j += 1u) {
    let w = skin.weights[j];
    if (w > 0.000001) {
      let m = bones[skin.bones[j]];
      outP += (m * hp).xyz * w;
      outN += (m * hn).xyz * w;
    }
  }
  outputVertices[index].position = vec4f(outP, 1.0);
  outputVertices[index].normal = vec4f(normalize(outN), 0.0);
  outputVertices[index].uv = vec4f(uv, base.uv.zw);
}
`;

export const RENDER_WGSL = /* wgsl */`
struct GlobalUniforms {
  viewProjection: mat4x4f,
  cameraPosition: vec4f,
  lightDirection: vec4f,
  lightColor: vec4f,
  ambientColor: vec4f,
  viewport: vec4f,
}
struct MaterialUniforms {
  diffuse: vec4f,
  ambient: vec4f,
  specularPower: vec4f,
  edgeColor: vec4f,
  textureTint: vec4f,
  sphereTint: vec4f,
  toonTint: vec4f,
  params: vec4f,
}
@group(0) @binding(0) var<uniform> globals: GlobalUniforms;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var baseTexture: texture_2d<f32>;
@group(1) @binding(2) var sphereTexture: texture_2d<f32>;
@group(1) @binding(3) var toonTexture: texture_2d<f32>;
@group(1) @binding(4) var textureSampler: sampler;

struct VsIn { @location(0) position: vec4f, @location(1) normal: vec4f, @location(2) uv: vec4f }
struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

@vertex fn vsMain(input: VsIn) -> VsOut {
  var result: VsOut;
  result.clip = globals.viewProjection * input.position;
  result.worldPosition = input.position.xyz;
  result.normal = input.normal.xyz;
  result.uv = input.uv.xy;
  return result;
}

@fragment fn fsMain(input: VsOut) -> @location(0) vec4f {
  let n = normalize(input.normal);
  let l = normalize(-globals.lightDirection.xyz);
  let v = normalize(globals.cameraPosition.xyz - input.worldPosition);
  let h = normalize(l + v);
  let ndl = clamp(dot(n, l), 0.0, 1.0);
  let base = textureSample(baseTexture, textureSampler, input.uv) * material.textureTint;
  let toon = textureSample(toonTexture, textureSampler, vec2f(0.5, 1.0 - ndl)) * material.toonTint;
  let spec = pow(clamp(dot(n, h), 0.0, 1.0), max(1.0, material.specularPower.w));
  var rgb = base.rgb * material.diffuse.rgb * (material.ambient.rgb * globals.ambientColor.rgb + toon.rgb * globals.lightColor.rgb);
  rgb += material.specularPower.rgb * globals.lightColor.rgb * spec;
  let sphereUv = n.xy * vec2f(0.5, -0.5) + vec2f(0.5);
  let sphere = textureSample(sphereTexture, textureSampler, sphereUv).rgb * material.sphereTint.rgb;
  let sphereMode = u32(material.params.x + 0.5);
  if (sphereMode == 1u) { rgb *= sphere; }
  if (sphereMode == 2u) { rgb += sphere; }
  let alpha = base.a * material.diffuse.a;
  if (alpha < 0.001) { discard; }
  return vec4f(rgb, alpha);
}

@vertex fn vsEdge(input: VsIn) -> VsOut {
  var result: VsOut;
  let scale = material.params.y * input.uv.z * globals.viewport.z;
  let expanded = vec4f(input.position.xyz + normalize(input.normal.xyz) * scale, 1.0);
  result.clip = globals.viewProjection * expanded;
  result.worldPosition = expanded.xyz;
  result.normal = input.normal.xyz;
  result.uv = input.uv.xy;
  return result;
}

@fragment fn fsEdge(input: VsOut) -> @location(0) vec4f { return material.edgeColor; }
`;
