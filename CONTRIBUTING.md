# Pixel Bonsai · 團隊開發準則

> 適用範圍：`ICG_Final/` 全體成員
> 目的：把「三個子目錄、三個人」的開發收斂成「一個 dev server、一個 demo URL」
> 凡是寫到「跨人協作」的事，本文件是 single source of truth。

---

## 1. TL;DR（最短閱讀路徑）

- **`01_webgl_tree` 是 unified host**：唯一啟動 dev server 的地方
  （`cd 01_webgl_tree && npm run dev`）。
- **`02_tree_growth` 與 `03_ray_tracing` 是 mode plugin**：各自在自己的目錄
  寫程式，但都 **export 一個 `mode` 物件**，被 01 的 `main.js` import 進來。
- **最終 demo**：一個 URL，畫面頂端三顆按鈕 `[Real-time] [Growth] [Path Trace]`
  切換 mode。沒有「跑 02 demo 要 cd 進 02」這種事。
- **Tree 是共用資產**：放在 `01_webgl_tree/src/scene/tree.js`。要動樹的人都
  改這裡，但 API 要 sync（見 §6）。

---

## 2. 目錄結構與 ownership

```text
ICG_Final/
├── 01_webgl_tree/              # host app（隊友 A 主導，但 main.js 共改）
│   ├── package.json            # 唯一的 npm 入口
│   ├── index.html              # 頂端三顆 mode 按鈕加在這
│   └── src/
│       ├── main.js             # mode 切換骨架（由負責 03 的人寫）
│       ├── modes/realtime.js   # 包裝原本的 pipeline.render（由 A 寫）
│       └── scene/tree.js       # 共用樹（由負責 02 的人主導）
├── 02_tree_growth/             # 隊友 B
│   └── src/growth.js           # export const mode = {...}
├── 03_ray_tracing/             # 隊友 C（yang）
│   ├── PLAN.md                 # 03 的實作細節
│   └── src/raytrace_mode.js    # export const mode = {...}
└── CONTRIBUTING.md             # 本文件
```

| 檔案 / 路徑 | 主負責人 | 其他人可改嗎 |
|---|---|---|
| `01_webgl_tree/src/scene/*`（除了 `tree.js`） | A | 不可，發 PR |
| `01_webgl_tree/src/scene/tree.js` | B（成長動畫主導） | C 可加 raytrace 友善的 hint，需先講 |
| `01_webgl_tree/src/main.js` | **C 維護骨架**，A/B 不直接改 | 不可，提 issue 給 C |
| `01_webgl_tree/index.html`、`ui.js` | A | 加新 mode 按鈕時 C 補 |
| `02_tree_growth/**` | B | 不可 |
| `03_ray_tracing/**` | C | 不可 |
| `docs/`、根 README | 共有 | 共改 |

ownership 的精神：**減少 git conflict，每個檔案盡量只有一個主編輯者**。

---

## 3. 統一 demo 架構

### 原則
- **不在 02 / 03 啟動獨立 dev server**。它們不是 app，是被 01 import 的 lib。
- 02 / 03 的目錄可以放自己的 README、實驗 script、報告素材，但**正式
  demo 程式碼都透過 plugin 接到 01**。

### 切 mode 的流程

1. 使用者按 `[Path Trace]` 按鈕
2. `main.js` 呼叫 `currentMode.dispose(ctx)`（清理上一個 mode）
3. `main.js` 切換 `currentMode = raytraceMode`
4. `main.js` 呼叫 `currentMode.init(ctx)`（建立新 mode 的資源）
5. 之後每 frame `render()` 內呼叫 `currentMode.render(ctx, time)`

---

## 4. Mode plugin 契約（最重要的一節）

每個 mode 都 export 一個物件，**形狀如下**（這是團隊契約，不可自創欄位）：

```js
// 範例：02_tree_growth/src/growth.js 或 03_ray_tracing/src/raytrace_mode.js
export const mode = {
  // 唯一識別字串，用來在 main.js 對應按鈕
  name: "growth",          // 或 "raytrace"

  // 顯示在 UI 按鈕上的標籤
  label: "Growth",         // 或 "Path Trace"

  // 切換進此 mode 時呼叫一次
  // 用來：建立 GPU 資源、註冊 event listener、開啟專屬 UI
  init(ctx) {},

  // render loop 每 frame 呼叫
  // 你完全接管畫面：可以呼叫 ctx.renderer.render(...)，或自己的 pathTracer
  render(ctx, time) {},

  // 切走此 mode 時呼叫一次
  // 用來：釋放 GPU buffer、移除 event listener、隱藏專屬 UI
  dispose(ctx) {},
};
```

### 一定要遵守的規則

- `init` 之後到 `dispose` 之間，**只有自己這個 mode 在動 renderer**。其他
  mode 不會跑。
- `dispose` **必須清乾淨**所有 mode 自建的 GPU 物件（texture、render target、
  pathTracer 等）與 DOM listener。否則切回去 real-time 會洩漏 / 卡住。
- **不要寫 module-level side effect**。所有狀態都放 `init` 裡建立、`dispose`
  裡釋放。例如 ❌ `const tracer = new WebGLPathTracer()` 寫在 module 頂層；
  ✅ 寫在 `init(ctx) { this.tracer = new WebGLPathTracer(ctx.renderer) }`。

---

## 5. 共用狀態 `ctx`

01 的 `main.js` 會把以下物件傳給每個 mode：

```js
ctx = {
  renderer,   // THREE.WebGLRenderer，所有 mode 共用同一個
  scene,      // THREE.Scene，所有物件都在這裡
  camera,     // PixelCamera 實例（見 01/src/camera.js），有 .camera 屬性是真 PerspectiveCamera
  sun,        // THREE.DirectionalLight，主光源（見 01/src/lighting.js）
  tree,       // THREE.Group，程序樹（見 §6 API 約定）
  world,      // buildWorld() 的回傳值：{ water, tree, grass, ground }
  settings,   // 全域 UI 設定（見 01/src/config.js）
};
```

### 約定

- **可讀**：任何 mode 都可以讀 `ctx` 內的任何欄位
- **可寫**：但要寫之前先想——你動的東西別的 mode 還會用嗎？例如
  `ctx.camera.position.set(...)` 在 raytrace mode 動相機，real-time mode
  切回去後相機是新位置，這通常是預期的。但如果你把 `ctx.world.grass.visible
  = false`，必須在 `dispose` 還原。
- **不可移除**：不要 `ctx.scene.remove(ctx.tree)`，這會破壞其他 mode。
  改用 `ctx.tree.visible = false` 並在 `dispose` 還原。

---

## 6. Tree API 約定

`01_webgl_tree/src/scene/tree.js` 是團隊共用的 procedural tree。02 / 03 都
要動它，**API 由 B（02 負責人）主導**，但 C（03）有 review 權。

### 目前 API（已存在）

```js
import { makeTree } from "./tree.js";
const tree = makeTree();   // THREE.Group，內部已組好幾何
ctx.tree.scale.set(s,s,s); // 整體縮放，01 README 第 90 行說明用於 growth
```

### 02 是否要新增 `setGrowth(t)`？

**由 B 決定，但決定前要跟 A、C 講一聲**。兩個選項：

| 選項 | 怎麼用 | 適合 |
|---|---|---|
| A：純 scale | `ctx.tree.scale.set(s, s, s)`，s ∈ [0.1, 1.0] | 只想做「整棵樹放大縮小」 |
| B：新增 `setGrowth(t)` | `ctx.tree.setGrowth(t)`，t ∈ [0, 1]，內部重建幾何 | 想做「分枝逐步長出」「葉子先少後多」 |

如果選 B：
- 由 B 在 `tree.js` 加 `tree.setGrowth = function(t) { ... }`
- t = 0 → 最小狀態（種子 / 樹苗），t = 1 → 滿樹
- **必須是 idempotent**（呼叫多次結果一致），因為 02 mode 切走再切回來會重叫
- C 需要在 raytrace mode 開始時讀當前 growth 狀態（決定要 trace 的幾何量）

---

## 7. 本機開發流程

### 第一次 setup

```bash
cd ICG_Final/01_webgl_tree
npm install
# C 還要額外裝（03 PLAN.md 列的）：
npm install three-gpu-pathtracer
```

### 日常開發

```bash
cd ICG_Final/01_webgl_tree
npm run dev
# 開 http://localhost:5173，三顆按鈕切 mode
```

Vite 的 HMR（hot module reload）跨資料夾也會生效——你在
`03_ray_tracing/src/raytrace_mode.js` 改檔，01 dev server 會自動 reload。

### 不要做的事

- ❌ 在 `02_tree_growth/` 或 `03_ray_tracing/` 加 `package.json` 並
  獨立 `npm install`。要的依賴都加到 `01_webgl_tree/package.json`。
- ❌ 在 02 / 03 裡 import 01 的 `main.js`。只 import 它需要的 module
  （例如 `import * as THREE from "three"`，或 `import { settings } from
  "../../01_webgl_tree/src/config.js"`）。

---

## 8. Git 流程

- **branch 命名**：`feat/02-growth-morph`、`feat/03-raytrace-init` 等
- **避免 conflict 的關鍵**：每個檔案盡量單一主編輯者（見 §2 ownership 表）
- **`main.js` 與 `tree.js` 的改動**：開 PR、找 reviewer 看過再 merge
- **大 demo 前**：建議在 demo 前一週把所有 PR merge 完，最後一週只修 bug
- 提交訊息：英文或繁中皆可，但要描述「改了什麼」+「為什麼」

---

## 9. 報告與 demo 交付清單

最終要交的東西（暫定，依老師要求調整）：

| 項目 | 主責 | 形式 |
|---|---|---|
| Live demo URL（或可執行的 dev build） | A + C | `npm run dev` 跑得起來 |
| Real-time 視圖截圖 | A | `docs/screenshots/` |
| Growth 動畫片段（GIF / mp4） | B | `docs/screenshots/` |
| Path-traced 截圖（pixel-art 版） | C | `docs/screenshots/` |
| Path-traced 寫實 hero shot（cel/outline 關閉） | C | `docs/screenshots/` |
| 三 mode 對照圖 | 共做 | `docs/screenshots/` |
| 技術報告 PDF | 三人各寫自己段落 | `docs/` |

---

## 10. 延伸閱讀

- `01_webgl_tree/` 渲染管線細節 → `README.md` 根目錄
- 03 ray tracing 實作細節 → [`03_ray_tracing/PLAN.md`](03_ray_tracing/PLAN.md)
- 03 的論文 / repo 引用清單 → 同上，§8

---

## 11. 衝突解決

若三人對某個契約有歧見（例如「tree 該怎麼長」「mode 切換該不該動相機」），
原則：
1. 先去看本文件 / PLAN.md 有沒有寫
2. 沒寫就在 group chat 提案 → 一週內無人反對視為同意 → 寫進本文件
3. 急事直接同步討論，做出決定後**仍要回填本文件**，不然下個月就忘了
