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
    port: 5173,
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
    include: ["three", "three-gpu-pathtracer", "three-mesh-bvh"],
  },
  build: { target: "es2020", outDir: "dist" },
});
