# 03 · Ray Tracing — 實作計畫

> 對應團隊專案：`ICG_Final/`
> 基底場景：`../01_webgl_tree/`
> 既有 Whitted tracer 參考：`../../term pj/python_raytracer/`
> 本文件記錄：(a) 統一 demo 平台架構、(b) ray-tracing 模組落地清單、
> (c) 與 02/03 隊友的協作介面。

---

## 一、目標

1. 在 `01_webgl_tree` 的 **同一份 Three.js scene graph** 上跑 path tracing，
   按鈕一按即可切換 real-time / path-traced 視圖。
2. **保留 pixel-art 美學**（low-res + cel ramp + outline + texel-snap camera），
   path tracer 輸出 linear color 後仍走原本的 post-process chain。
3. 最終 demo **單一 URL、單一 `npm run dev`**，三顆按鈕切三種模式：
   `[Real-time]` `[Growth]` `[Path Trace]`。報告中保留一張關掉 cel/outline
   pass 的「寫實 hero shot」作對照。

---

## 二、統一 demo 平台架構

### 結論：把 `01_webgl_tree` 升級為 unified host，02 / 03 註冊成 mode plugins。

理由：
- `01_webgl_tree` 本來就是完整的 Vite app（render loop、scene、UI、相機、太陽光）。
- 02 的 growth 只是動 `tree.js` 的參數（01 README 已明寫此設計）。
- 03 的 `three-gpu-pathtracer` 必須吃同一個 Three.js scene 物件，住在 01 裡最自然。
- 對外只暴露一份 URL。

### 目錄重構（建議）

```text
ICG_Final/
├── 01_webgl_tree/              # 從「base」升級為「host app」
│   ├── src/
│   │   ├── main.js             # 增加 mode 切換邏輯
│   │   ├── modes/              # 新增資料夾
│   │   │   ├── realtime.js     # 包裝原本的 pipeline.render
│   │   │   ├── growth.js       # 02 的 plugin（隊友維護）
│   │   │   └── raytrace.js     # 03 的 plugin（你維護，import 自下方）
│   │   └── ... (scene/lighting/camera 不動)
│   └── package.json            # 加 three-gpu-pathtracer 依賴
├── 02_tree_growth/             # 隊友的源碼留在這
│   └── src/growth.js           # 暴露 mode plugin（被 01 import）
├── 03_ray_tracing/             # 你的源碼留在這
│   ├── PLAN.md                 # 本文件
│   └── src/
│       ├── raytrace_mode.js    # 暴露 mode plugin（被 01 import）
│       ├── post_pixelart.js    # cel ramp + outline 後處理（從 01 pipeline 抽出）
│       └── alpha_leaf.js       # hashed alpha 葉子材質
└── docs/                       # 共用截圖、報告素材
```

`02` / `03` **不獨立 build**，只暴露一個 plugin 模組給 01 import。
這樣每位隊友還是有自己的目錄當開發空間，但最終只啟動一個 dev server。

### Mode plugin 介面

所有 mode 暴露相同形狀的物件，`01/src/main.js` 透過 `currentMode` 分派：

```js
// 形狀（TypeScript-style 註解）
export const mode = {
  name: "raytrace",
  label: "Path-Traced",

  // 切換進此 mode 時呼叫一次。可建立 pathTracer、額外 UI、event listener。
  init(ctx) {},

  // render loop 每 frame 呼叫。real-time mode 維持原本的 pipeline.render；
  // raytrace mode 改成 pathTracer.renderSample() + post_pixelart compose。
  render(ctx, time) {},

  // 切走此 mode 時呼叫。釋放 GPU buffer / DOM 控制項。
  dispose(ctx) {},

  // 可選：本 mode 專屬的 UI（如「累積樣本數」「split-screen 對照」等），
  // 切走時自動隱藏。
  ui: [],
};

// ctx 是 host 提供的共享狀態：
// ctx = { renderer, scene, camera, sun, tree, world, settings }
```

### `main.js` 改動點

只需要兩段改動：

```js
import { realtimeMode } from "./modes/realtime.js";
import { growthMode } from "../../02_tree_growth/src/growth.js";
import { raytraceMode } from "../../03_ray_tracing/src/raytrace_mode.js";

const modes = [realtimeMode, growthMode, raytraceMode];
let currentMode = realtimeMode;
const ctx = { renderer, scene, camera: pixel, sun: lighting.sun, tree: world.tree, world, settings };
currentMode.init(ctx);

// render loop:
function render() {
  const time = clock.getElapsedTime();
  // ... 原本的 cloud / water / dust 更新照舊 ...
  currentMode.render(ctx, time);
  tickFps();
}

// UI：頂端三顆 mode 按鈕（加在 index.html 既有的 toggle 之外）
function switchMode(next) {
  currentMode.dispose(ctx);
  currentMode = next;
  next.init(ctx);
}
```

### 與 02 隊友的協作介面

跟隊友講好兩件事：

1. **02 的 plugin 要暴露 `mode` 物件**，住在
   `02_tree_growth/src/growth.js`，被 01 用相對路徑 import。
2. **共用 tree handle**：02 透過 `ctx.tree` 直接動 `tree.scale` 或呼叫
   `world.tree.setGrowth(t)`。若 02 要做真正的「morphing」（不只縮放），
   就在 `tree.js` 加 `setGrowth(t)` 方法，**API 雙方共同維護**。
3. **不要 import 整份 main.js**，否則互相依賴會死。所有共享狀態都從 `ctx`
   進來，03 跟 02 互不知道對方存在。

---

## 三、三個 architectural blockers（動工前必讀）

研究報告（21/25 verified claims，4 refuted）發現
[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
v0.0.24 對本場景有三個硬限制，**必須先解，否則跑不起來**：

### B1. 不支援 instanced geometry — 18000 grass blade 致命

- 來源：[README Gotchas](https://github.com/gkjohnson/three-gpu-pathtracer)
  *"Instanced geometry and interleaved buffers are not supported."*
- 影響：`01_webgl_tree/src/scene/grass.js` 的 instanced 18k blade 進 path
  tracer 會直接灌爆 BVH。`PathTracingSceneGenerator` 把可見 mesh 攤平成
  單一 buffer。
- **三選一 mitigation**（建議走 (c) 開始，能跑了再優化到 (a)）：
  - (a) Merge 草葉成單一 `BufferGeometry`（每片葉子當獨立三角形對）
  - (b) Path-traced 模式下降密度到 ~1000
  - (c) Path-traced view 直接 cull 草葉，只保留樹/岩/水/花（最快出第一張圖）
- **不要依賴** three-mesh-bvh 的實驗性 `ObjectBVH`，**未連通** path tracer
  的 GPU traversal shader（research 中 0-3 refuted）。

### B2. 只支援 MeshStandardMaterial / MeshPhysicalMaterial

- 來源：[README Gotchas](https://github.com/gkjohnson/three-gpu-pathtracer)
  *"Only MeshStandardMaterial and MeshPhysicalMaterial are supported."*
- 影響：`01_webgl_tree/src/materials.js` 的 `toonMaterial`、`pipeline.js`
  的 outline pass、cel ramp、cloud shadow injection 在 path-traced pass
  **完全失效**。
- **作法**：
  - Path tracer 內把所有材質暫換成 `MeshStandardMaterial`（保留 base
    color），透過 `roughness=1, metallic=0` 模擬原本的 diffuse-only 視覺。
  - Path tracer 跑完輸出 linear color texture。
  - 把 `01/src/pipeline.js` 的 cel ramp + outline + low-res upscale 抽成
    `03/src/post_pixelart.js`，作用在 path tracer 輸出 texture 上。
  - 這正是 **「在 path-traced GI 上實作 pixel-art post-process pipeline」**
    的技術貢獻，可寫進報告。

### B3. 內建 denoiser 弱（只有 glslSmartDenoise），OIDN 要外掛

- 來源：[CHANGELOG](https://github.com/gkjohnson/three-gpu-pathtracer/blob/main/CHANGELOG.md)
  唯一條目 `[0.0.7] 2022-10 DenoiseMaterial based on glslSmartDeNoise`；
  [issue #85](https://github.com/gkjohnson/three-gpu-pathtracer/issues/85)
  與 #292 都仍 open。
- **作法**：兩個 plug-in 選項
  - [DennisSmolek/Denoiser](https://github.com/DennisSmolek/Denoiser) —
    tfjs WebGL backend，mobile fallback 完整，**首選**
  - [pissang/oidn-web](https://github.com/pissang/oidn-web) —
    WebGPU-only（tfjs-backend-webgpu），有現成
    [three-gpu-pathtracer 範例](https://oidn-web-example.vercel.app/three-gpu-pathtracer.html)。
    舊瀏覽器掉。
- 兩者都用 OIDN 官方 pretrained `rt_hdr_alb_nrm` 權重，
  需要從 path tracer 拉 albedo + normal AOV。
- **與 term pj 關係**：你 term pj 的 `raytracer/denoise.py` 已實作過 OIDN
  Python binding + bilateral fallback，概念對應，知識直接搬。

---

## 四、Prioritized landing list（按「demo 加成 ÷ 工時」排序）

| # | 項目 | 工時 | 來源 | 與 term pj 關係 |
|---|------|------|------|----------------|
| **1** | 接 `WebGLPathTracer` 跑出第一張光追圖（先用 B1 mitigation (c) cull 草葉） | 半天 | [repo v0.0.21+ API](https://github.com/gkjohnson/three-gpu-pathtracer) | 取代 term pj 的 renderer |
| **2** | 把 cel ramp + outline + low-res upscale 抽成 post-process 作用在 path tracer 輸出 | 半天 | 從 `01/src/pipeline.js` 抽 | 全新 |
| **3** | Mode plugin 架構落地（main.js + modes/ + 三顆按鈕） | 1 天 | 本 PLAN 第二節 | 全新 |
| **4** | 18k grass mitigation 升級到 (a)：merge 成單一 BufferGeometry | 半天 | `BufferGeometryUtils.mergeGeometries` | 全新 |
| **5** | 接 [DennisSmolek/Denoiser](https://github.com/DennisSmolek/Denoiser) 做 OIDN 後處理 | 1 天 | [issue #85](https://github.com/gkjohnson/three-gpu-pathtracer/issues/85) | **延伸** term pj OIDN 經驗 |
| **6** | Hashed Alpha Testing 給葉子貼圖（[Wyman & McGuire 2017](https://research.nvidia.com/publication/hashed-alpha-testing)） | 半天 | NVIDIA paper | 全新 |
| **7** | 開啟 `FEATURE_SOBOL` define + stratified sampling | 1 小時 | [CHANGELOG 0.0.17/0.0.18](https://github.com/gkjohnson/three-gpu-pathtracer/blob/main/CHANGELOG.md) | **延伸** term pj 的 Owen-scrambled Sobol |
| **8** | Habel 2007 雙面葉片 BSSRDF 近似（用 MeshPhysicalMaterial 的 transmission + thickness 逼近） | 1 天 | [Habel 2007 EGSR PDF](https://www.cg.tuwien.ac.at/research/publications/2007/Habel_2007_RTT/Habel_2007_RTT-Preprint.pdf) | 全新 |
| **9** | 報告 hero shot：關掉 cel/outline pass 跑寫實版 | 1 小時 | — | 直接出圖 |

最小可交付 = 1 + 2 + 3 + 4。
能拿高分 = 加 5 + 6 + 7。
加分項 = 8 + 9。

---

## 五、實作階段與 milestone

### M1：mode 架構打通（先做架構不做 ray tracing）
- 在 01 加 `src/modes/realtime.js`，包裝原本的 `pipeline.render` 邏輯。
- 加 `index.html` 頂端三顆 mode 按鈕（先只有 Real-time 是 active）。
- 跟隊友 sync：02 要在這個架構下交付 `growth.js` plugin。
- **驗收**：`npm run dev` 開起來跟之前一樣，只是 main.js 改用 `currentMode.render(ctx, time)`。

### M2：第一張光追圖
- `npm install three-gpu-pathtracer`。
- 寫 `03/src/raytrace_mode.js` 的 `init`：
  - `cull 掉 ctx.world.grass`（mitigation c）
  - 把 `tree`、`rocks`、`flowers` 的材質暫換成 `MeshStandardMaterial`
  - 建 `WebGLPathTracer`，設 env map（HDR 天空）
- `render`：呼叫 `pathTracer.renderSample()`，把輸出 blit 到 canvas。
- 滑鼠移動或設定改變時 reset 累積。
- **驗收**：按 `[Path Trace]` 能看到一張低 spp 的場景，慢慢收斂。

### M3：pixel-art post-process 接回去
- 把 `01/src/pipeline.js` 的 cel ramp + outline + low-res upscale 抽成
  `03/src/post_pixelart.js`，吃一張 color texture + depth/normal AOV。
- raytrace_mode 的 render 改成：path tracer → AOV → post_pixelart → canvas。
- **驗收**：path-traced 視圖跟 real-time 視圖風格一致，但陰影更柔軟、有 bounce。

### M4：grass merge 升級
- 寫一個 `mergeGrass(grass)` 函式：讀 `InstancedMesh` 的所有 matrix，
  apply 到 base geometry 上，輸出單一 `BufferGeometry`。
- path-traced mode 用 merged 版，real-time 用 instanced 版（兩者保留）。

### M5：OIDN 降噪
- `npm install denoiser`（DennisSmolek 套件）或從 oidn-web 抓。
- raytrace_mode 加 AOV 輸出（albedo + normal）。
- 在 post_pixelart 之**前**插一層 denoise pass。
- **驗收**：1–4 spp 直接看起來像 32 spp。

### M6：報告對照圖
- raytrace mode 加一個「寫實對照」開關，按下後 bypass post_pixelart。
- 截圖：real-time、path-traced pixel-art、path-traced photoreal 三張對照。

---

## 六、反駁清單（不要踩這幾個坑）

研究中明確 refuted、寫文時也不要 cite 的項目：

| 直覺以為可以但**不行** | 反駁來源 |
|---|---|
| `ObjectBVH` 可以解 instanced grass | 未連通 GPU traversal shader（0-3） |
| `oidn-web` 有 WASM fallback | 只有 WebGPU backend（0-3） |
| three-gpu-pathtracer 有官方 WebGPU release | 只有 forum 公告的 dev branch（0-3） |
| maintainer 已實作 `pathtracer.enableDenoiser = true` 一鍵 API | 仍 open issue，沒做（0-3） |

---

## 七、未驗證的研究線（要寫進報告時建議自己再 check）

下列研究線本批 21 條 verified claims 沒覆蓋，**不能直接當 ground truth**：

1. **Stylized / NPR path tracing 2022–2025**——
   [LuisaGroup/practical-stylized](https://github.com/LuisaGroup/practical-stylized)
   與 [ACM TOG 2024 (3658161)](https://dl.acm.org/doi/10.1145/3658161) 抓到但
   未驗證可落地。
2. **Wilkie 2021 / ARPrague analytic sky model** GLSL 落地版本未驗證。
   對戶外 god rays **非必要**——先用 HDR env map 替代即可。
3. **NVIDIA Spatiotemporal Blue Noise SDK** ([NVIDIA-RTX/STBN](https://github.com/NVIDIA-RTX/STBN))
   是否能用在 WebGL2 + 與 RANDOM_TYPE 整合未驗證。
4. **SVGF / A-SVGF on WebGL**——issue #292 仍 open，社群無可用 fork。
   **直接走 OIDN，不要碰**。
5. **2022+ leaf BSDF GPU 變體**——Habel 2007 雖經典但 20 年了，可能有更近的版本。

---

## 八、引用清單

### 核心倉庫
- [gkjohnson/three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) — 主引擎 v0.0.24
- [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — BVH 後端
- [DennisSmolek/Denoiser](https://github.com/DennisSmolek/Denoiser) — OIDN WebGL port（首選）
- [pissang/oidn-web](https://github.com/pissang/oidn-web) — OIDN WebGPU port
- 範例：<https://oidn-web-example.vercel.app/three-gpu-pathtracer.html>

### 論文
- Wyman & McGuire, *Hashed Alpha Testing*, I3D 2017 — <https://research.nvidia.com/publication/hashed-alpha-testing>
- Habel, Kusternig & Wimmer, *Physically Based Real-Time Translucency for Leaves*, EGSR 2007 — <https://www.cg.tuwien.ac.at/research/publications/2007/Habel_2007_RTT/Habel_2007_RTT-Preprint.pdf>

### 既有研究文件
- [`../../term pj/python_raytracer/docs/SIGGRAPH_RESEARCH.md`](../../term%20pj/python_raytracer/docs/SIGGRAPH_RESEARCH.md) — Whitted tracer 角度的研究調查
- [`../../term pj/python_raytracer/docs/OPTIMIZATIONS.md`](../../term%20pj/python_raytracer/docs/OPTIMIZATIONS.md) — 已落地的 4 個 SIGGRAPH-era 優化

---

## 九、目前進度與接續指南（2026-06-02 更新）

> 開發分支：**`feat/ray-tracing`**（從 main 開出，所有 RT showcase 工作在此 commit，
> 最後由隊員合併回 main）。在別台電腦接續前先 `git checkout feat/ray-tracing && git pull`。

### 9.1 已完成（含 PLAN 原清單對應）

| 項目 | 狀態 | 檔案 |
|---|---|---|
| 1-3 path tracer + pixel-art post + mode 架構 | ✅ | `raytrace_mode.js` / `post_pixelart.js` / `01/src/main.js` |
| 4 grass/foliage merge 成 static geometry | ✅ | `merge_instances.js` |
| IBL gradient env（補被丟掉的 HemisphereLight，B4） | ✅ | `raytrace_mode.js`（`GradientEquirectTexture`, `ENV_INTENSITY=1.0`） |
| Windows/multi-GPU 修復（BVH worker、DoubleSide、dispose bug） | ✅ | commit `98d3801` |
| 樹葉 NaN 崩潰修復（top skirt `shelfR(1)=0` → `0/0`） | ✅ | `01/src/scene/tree.js`、`merge_instances.js`（non-finite 實例 fail-soft 跳過） |
| cel ramp 最暗 band 不再壓成純黑（lifted shadow floor 0.22） | ✅ | `post_pixelart.js`（`CEL_SHADOW_FLOOR`） |
| 樹葉著色法線改朝世界上方（對齊即時 billboard 打光） | ✅ | `merge_instances.js` |
| 樹冠覆蓋率（2→3 quad asterisk + 1.4x，補滿葉縫看穿問題） | ✅ | `merge_instances.js`（`FOLIAGE_FRAMES`） |
| **1 樹葉亮度/顏色微調（黑樹冠修復）** | ✅ | `merge_instances.js` + `post_pixelart.js`（見下方說明） |
| **8 葉片半透明（Habel 2007 近似）** | ✅ 改用 emissive | `merge_instances.js`（transmission 近似在密集疊片下越疊越黑，改用 Habel 的「additive self-illumination」做法＝emissive glow floor） |
| **9 寫實 hero shot 對照切換** | ✅ | `raytrace_mode.js`（`#pt-photoreal` 按鈕）+ `post_pixelart.js`（`renderPhotoreal`：bypass cel/outline，純 ACES+sRGB 全解析度輸出） |
| **7 stratified sampling 確認** | ✅ 確認預設已開 | three-gpu-pathtracer 預設 `RANDOM_TYPE=2`（stratified list，等同 term pj 的 Owen-scrambled Sobol 精神）；Sobol(type1) 會壞 macOS compiler，不動 |

**樹冠由黑變綠的關鍵診斷（item 1，路徑追蹤沙箱逐張比對得出）**：
1. **看穿到黑**：sprig 貼圖是稀疏羽狀 alpha cutout（alphaTest 0.5），在真正的 GI 下相機光線會穿過葉縫，
   打到自陰影的樹冠內部＋棕色 core，於是樹冠變成近黑剪影；即時 billboard 永遠面向相機所以看不到這問題。
   **解法**：foliage 端**丟掉 alpha cutout**，烘成**實心**交叉 quad（3-quad asterisk 直接填滿、無縫），
   葉色改由 per-instance vertex-colour 漸層（tree.js 的 dark→warm，再 lerp 向亮綠 `_LIFT` 0x9ccc6a 提亮）提供。
2. **半透明（item 8）**：原本 `MeshPhysicalMaterial` transmission 在多層疊片下 Beer-Lambert 吸收越疊越黑；
   改成 Habel 2007 real-time 近似的本質做法——**additive self-illumination（emissive glow floor 0x4c7d33 @0.7）**，
   path tracer 直接在表面加 emission（不被 albedo 調制、也不被前方葉片吸收），陰影內葉片有柔和綠光、不再壓黑。
   `roughness=1.0` 讓葉片純漫反射，避免偏藍天空 env 在暗綠葉面上反出紫色高光。
3. **post 去飽和過頭**：`post_pixelart.js` COMP grade 原本 `mix(luma,color,0.88)`＋airy wash 0.11 把綠吃掉，
   放寬到 0.94 / 0.07 讓綠更跳（只影響 PT 視圖，不動即時端）。

**目前 demo 視覺狀態**：樹冠已是完整、飽和的針葉綠（pixel-art / photoreal 兩視圖都正常），
地面有 path-traced 柔和接觸陰影。三張對照圖見 `docs/screenshots/compare_*.png`。

### 9.2 待完成（接續工作，依優先序）

> 註：原 §9.2 的 item 1（樹葉微調）、7（stratified）、9（hero shot）已完成，移到 §9.1。

1. **PLAN 項目 5 — OIDN 降噪**（1 天,效能/畫面最大加成,**下一個最該做**）
   - 套件：[DennisSmolek/Denoiser](https://github.com/DennisSmolek/Denoiser)（tfjs WebGL backend，首選）。
   - 需從 path tracer 拉 albedo + normal AOV（`post_pixelart._renderNormals` 已有 normal prepass 可重用,
     albedo 要另接）。在 `post_pixelart` 之**前**插一層 denoise。目標：4 spp ≈ 32 spp。
   - 注意 §9.3 B：裝套件請在專案外或小心 lockfile/Vite optimize。

2. **PLAN 項目 6 — Hashed Alpha Testing（Wyman & McGuire 2017）**（半天）
   - **現況變更**：foliage 端已**不再用 alpha cutout**（改實心 quad,見 §9.1），所以原本「path tracer
     端 stochastic transparency」這條已無對象。本項剩**即時端**（real-time billboard shader）。
   - 作法（對應原 PLAN 的 `alpha_leaf.js`）：在 `01/src/materials.js` 的 billboard fragment shader
     注入 `hash(worldPos)` 當 alpha 門檻取代硬 `alphaTest 0.5`,配合 TAA/累積得到柔邊。報告放即時端一張。

3. **（選）樹冠精修**：目前 foliage 是實心 vertex-colour quad,失去細葉剪影（pixel-art 解析度下其實看不太出來,
   outline pass 也會重新風格化）。若要更細緻,可評估：(a) 在實心樹冠**外殼**再疊一層 alpha-cutout 葉片補細節,
   或 (b) 提高 emissive glow 對比讓 tier 更分明。亦可微調 `_LIFT` / `FOLIAGE_LIFT` / emissive 讓頂部更暖。

### 9.3 開發/驗證須知（踩過的雷,務必先讀）

**A. 在自動化/headless 瀏覽器裡 path tracer 會卡在 0 spp(但互動式 Chrome 正常)**
- 原因:headless 的 GPU process 裡 `KHR_parallel_shader_compile` 的完成狀態永遠不翻 true,
  導致 `WebGLPathTracer` 的 `isCompiling` 永遠是 true、`pathTracer.update()` 每幀被跳過。
- 驗證用 workaround:在頁面注入隱藏該擴充(讓 three 的 `compileAsync` 同步 resolve):
  ```js
  // puppeteer: page.evaluateOnNewDocument(...)
  for (const proto of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const orig = proto.prototype.getExtension;
    proto.prototype.getExtension = function (n) {
      return n === "KHR_parallel_shader_compile" ? null : orig.call(this, n);
    };
  }
  ```
- **這是測試專用、不要寫進 app 程式碼**。真機不需要。

**B. 不要在專案內 `npm install` 臨時測試套件**
- 改動 `01_webgl_tree/package-lock.json` 會觸發 Vite 重新 optimize deps,中斷時會留下
  半寫的 `node_modules/.vite/deps_temp_*`,導致 BVH worker 載入失敗:
  `Uncaught Error: GenerateMeshBVHWorker: undefined`(worker 模組 load error,訊息為 undefined)。
- 解法:刪 `01_webgl_tree/node_modules/.vite` 後重啟 dev server、hard reload。
- 測試瀏覽器(puppeteer)請裝在**專案外的獨立資料夾**(見 C)。

**C. 沙箱截圖驗證流程(每改一步自己截圖比對)**
- 在專案外建獨立 puppeteer 環境,避免污染專案 lockfile:
  ```bash
  mkdir -p ~/pptr-sandbox && cd ~/pptr-sandbox
  npm init -y && npm i puppeteer-core@23
  ```
- 啟動 dev server:`cd 01_webgl_tree && npm run dev`(注意實際 port,常被佔用而跳 5174/5175)。
- 截圖腳本要點:headful + 反節流 flags(`--disable-renderer-backgrounding` 等)+ 上面 A 的
  擴充隱藏 + 點 `.mode[data-mode="raytrace"]` + 輪詢 `#pt-hud` 的 spp 到 ~48 + 截圖。
  收斂約 10-15 秒(transmission 會稍慢)。
- 指向正確的 `http://localhost:<port>/`。

### 9.4 關鍵檔案地圖
- `03_ray_tracing/src/raytrace_mode.js` — mode plugin:hide instanced/points/water →
  merge billboards(foliage `foliage:true`,grass `false`)→ 換 MeshStandardMaterial →
  IBL env → perspective cam → `WebGLPathTracer`(stratified sampling,見 §9.1 item 7)+ BVH worker →
  每 frame `renderSample` + post。`#pt-photoreal` 按鈕切 pixel-art / photoreal(`_state.photoreal`)。
- `03_ray_tracing/src/merge_instances.js` — billboard→static crossed-quad 烘焙;`FRAMES`(grass 2 quad)
  / `FOLIAGE_FRAMES`(foliage 3 quad asterisk + 1.4x);**foliage = 實心 quad + vertex-colour 漸層(`_LIFT` 提亮)
  + emissive glow floor(Habel 近似)**;grass = map + alphaTest cutout。
- `03_ray_tracing/src/post_pixelart.js` — `render()`:cel ramp(含 `CEL_SHADOW_FLOOR`)+ outline + low-res
  upscale + COMP grade(去飽和已放寬);`renderPhotoreal()`:bypass 全部,純 ACES+sRGB 全解析度(hero shot)。
- `01_webgl_tree/src/scene/tree.js` — 樹幾何;foliage instance 生成(droop 已修 `R>0` 防 NaN)。
- 驗證沙箱:`~/pptr-sandbox/shot.mjs`(headful + KHR ext hider,`--mode/--spp/--clicks/--motionoff/--clean`)。
