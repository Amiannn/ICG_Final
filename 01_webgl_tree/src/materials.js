import * as THREE from "three";
import { makeToonRamp, makeCloudTexture } from "./textures.js";
import { toonRamp } from "./config.js";

// Shared ramp + cloud-shadow uniforms. The uniforms are injected by *reference*
// into every toon material via onBeforeCompile, so updating them here updates
// the whole scene at once -- this is the article's global shader uniform +
// get_cloud_attenuation() abstraction.
const ramp = makeToonRamp(toonRamp);

export const cloudUniforms = {
  uCloudMap: { value: makeCloudTexture(256) },
  uCloudTime: { value: 0 },
  uCloudStrength: { value: 1.0 },
  uCloudScale: { value: 0.018 }, // world units -> uv
  uCloudDir: { value: new THREE.Vector2(0.6, 0.2) },
};

const CLOUD_COMMON = /* glsl */ `
  uniform sampler2D uCloudMap;
  uniform float uCloudTime;
  uniform float uCloudStrength;
  uniform float uCloudScale;
  uniform vec2 uCloudDir;
  varying vec3 vCloudWorldPos;

  // Soft cloud attenuation in [1-strength, 1] sampled from scrolling noise over
  // world XZ. Two layers at different speeds keep it from looking like a single
  // sliding texture.
  float getCloudAttenuation(vec3 worldPos) {
    vec2 uv = worldPos.xz * uCloudScale;
    float a = texture2D(uCloudMap, uv + uCloudDir * uCloudTime).r;
    float b = texture2D(uCloudMap, uv * 0.5 - uCloudDir * uCloudTime * 0.6).r;
    float shadow = smoothstep(0.42, 0.72, a * 0.6 + b * 0.6);
    return 1.0 - shadow * uCloudStrength * 0.7;
  }
`;

function injectCloudShadows(shader) {
  shader.uniforms.uCloudMap = cloudUniforms.uCloudMap;
  shader.uniforms.uCloudTime = cloudUniforms.uCloudTime;
  shader.uniforms.uCloudStrength = cloudUniforms.uCloudStrength;
  shader.uniforms.uCloudScale = cloudUniforms.uCloudScale;
  shader.uniforms.uCloudDir = cloudUniforms.uCloudDir;

  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\n  varying vec3 vCloudWorldPos;",
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
        vec4 cloudWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cloudWorld = instanceMatrix * cloudWorld;
        #endif
        vCloudWorldPos = (modelMatrix * cloudWorld).xyz;`,
    );

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    "#include <common>\n" + CLOUD_COMMON,
  );

  // outgoingLight exists after the lighting chunks; opaque_fragment writes it
  // out. (output_fragment fallback covers older three builds.) Match the bare
  // include token so we don't depend on its surrounding indentation.
  const inject = "outgoingLight *= getCloudAttenuation(vCloudWorldPos);\n  ";
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <opaque_fragment>", inject + "#include <opaque_fragment>")
    .replace("#include <output_fragment>", inject + "#include <output_fragment>");
}

// Standard cel-shaded surface with cloud shadows.
export function toonMaterial(color, opts = {}) {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...opts });
  mat.onBeforeCompile = injectCloudShadows;
  return mat;
}

// Billboard material: alpha-cut blob sprite, normals forced upward so quads are
// lit evenly like the ground they sit on (the article writes to LIGHT_VERTEX to
// flatten grass lighting -- here we just hand the lighting an up normal).
export function billboardMaterial(map, color = 0xffffff) {
  const mat = new THREE.MeshToonMaterial({
    map,
    color,
    gradientMap: ramp,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    injectCloudShadows(shader);
    // Flatten the shading normal to world-up so every billboard receives the
    // same diffuse term as the flat terrain -> tufts blend instead of popping.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      "#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);",
    );
  };
  return mat;
}

// Instanced billboard material for grass tufts and tree leaves. Each instance's
// matrix supplies a world anchor + (sx, sy) scale; the quad is expanded in view
// space so it always faces the camera. `upright` keeps blades standing (rotate
// around world-up only) instead of fully facing the camera.
export function instancedBillboardMaterial(map, { color = 0xffffff, upright = false } = {}) {
  const mat = new THREE.MeshToonMaterial({
    map,
    color,
    gradientMap: ramp,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });

  const expand = upright
    ? `
      vec3 wUp = vec3(0.0, 1.0, 0.0);
      vec3 toCam = normalize(cameraPosition - anchorWorld);
      vec3 wRight = normalize(cross(wUp, toCam));
      vec3 worldPos = anchorWorld + position.x * sx * wRight + position.y * sy * wUp;`
    : `
      vec3 wRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 wUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 worldPos = anchorWorld + position.x * sx * wRight + position.y * sy * wUp;`;

  mat.onBeforeCompile = (shader) => {
    injectCloudShadows(shader);

    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `
      vec4 anchorOS = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        anchorOS = instanceMatrix * anchorOS;
      #endif
      vec3 anchorWorld = (modelMatrix * anchorOS).xyz;
      float sx = 1.0;
      float sy = 1.0;
      #ifdef USE_INSTANCING
        sx = length(instanceMatrix[0].xyz);
        sy = length(instanceMatrix[1].xyz);
      #endif
      ${expand}
      vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      vCloudWorldPos = anchorWorld;
      `,
    );

    // the begin_vertex cloud assignment runs before anchorWorld exists; drop it
    // (we set vCloudWorldPos from the billboard anchor in project_vertex instead)
    shader.vertexShader = shader.vertexShader.replace(
      "vCloudWorldPos = (modelMatrix * cloudWorld).xyz;",
      "// cloud world pos set after billboarding",
    );

    // even, ground-matching lighting
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      "#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);",
    );
  };

  return mat;
}

export { ramp };
