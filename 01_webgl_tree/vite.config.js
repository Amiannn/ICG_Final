import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = path.resolve(here, "node_modules");

// Sibling-dir plugins (`02_tree_growth/`, `03_ray_tracing/`) live outside
// `01_webgl_tree/` and import bare packages like `three` and
// `three-gpu-pathtracer`. Aliasing those bare specifiers to this app's
// node_modules makes Vite resolve them from any cross-dir source file.
export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 3000,
    fs: {
      // allow reading files from the parent ICG_Final/ directory
      allow: [path.resolve(here, ".."), here],
    },
  },
  resolve: {
    alias: {
      three: path.join(nm, "three"),
      "three-gpu-pathtracer": path.join(nm, "three-gpu-pathtracer"),
      "three-mesh-bvh": path.join(nm, "three-mesh-bvh"),
    },
  },
  optimizeDeps: {
    // three-mesh-bvh ships web workers that do
    //   new Worker(new URL("./xxx.worker.js", import.meta.url), { type: "module" })
    // Pre-bundling it into .vite/deps breaks that relative worker URL, so the
    // worker fails to load ("GenerateMeshBVHWorker: undefined"). Excluding it
    // (and three-gpu-pathtracer, which depends on it) serves both from source
    // so the URL resolves and they share a single three-mesh-bvh instance.
    include: ["three"],
    exclude: ["three-gpu-pathtracer", "three-mesh-bvh"],
  },
  // Emit workers as ES modules (needed for `new Worker(url, { type: "module" })`
  // to work in the production build, not just dev).
  worker: { format: "es" },
  build: { target: "es2020", outDir: "dist" },
});
