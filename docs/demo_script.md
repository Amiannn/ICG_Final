# Pixel Bonsai — 3 分鐘 Demo 講稿

> 給上台 demo 用的逐字稿 + 技術 Q&A 補充。實際講不一定照念，但每段把重點關鍵字提到就 OK。
> 三個 mode（Real-time / Growth / Path Trace）建議都切一下，每個停 20-30 秒看實際效果。

---

## 0. 開場（15 秒）

> 「我們做的這個專案叫 **Pixel Bonsai**，一個 3D 的 stylized 杉木場景，用 Three.js 做。靈感來自 David Holland 的 *3D Pixel Art Rendering* 那篇文章，但所有渲染管線都是我們從頭實作的，沒有用他的程式碼。」

【螢幕停在 Real-time 模式，預設視角】

---

## 1. Real-time 模式 — Pixel-art rendering pipeline（90 秒）

> 「畫面看起來像 pixel art，但其實底層是完整的 3D 場景。整個畫面渲染到一個 **低解析度的 render target**（預設 420px 高），再用 nearest-neighbor 升頻到 canvas — 這是 pixel art 感的來源。」

> 「如果單純這樣做，鏡頭一動畫面會 **swim**（次像素亂跳），所以我們做了兩件事：
> 1. **Texel snapping** — 相機沿著 view-aligned 的 texel 網格對齊
> 2. **Sub-pixel offset** — 在最後 composite shader 把次像素誤差補回去，整體運動就會平順」

【可以拖動視角示意 — 注意像素跳動不會像普通低解析那樣亂晃】

> 「Cel shading 用 Three.js 的 `MeshToonMaterial` 加一個共用的 4 段 toon ramp `DataTexture`。」

> 「雲影是 procedural 的 — 我們用 `onBeforeCompile` hook 把一個 scrolling Perlin noise 注入到**所有** material 的 fragment shader，這樣樹葉、地面、岩石都會被同一張雲影遮罩經過，省了真的雲幾何體。」

> 「邊緣 outline 是後處理 — depth + view-normal 兩張 prepass，用 4-tap 鄰居採樣 detect 深度斷層或法向急轉。」

【打開 Outline strength 滑桿示意】

> 「God rays 是 screen-space 的 — 每個 pixel 沿著朝太陽方向 jittered raymarch，撞到天空（depth ≈ 1）就累積亮度，再用垂直於光向的條紋函數調制成有質感的光柱。」

【可以切 God rays 開關示意】

> 「水池是 **planar reflection** — 把相機鏡像翻到水面下方再渲染一次到 reflection RT。為了避免 backface culling 反轉，我們在反射 pass 暫時把所有 material 強制 DoubleSide。」

> 「另外還有 day/night cycle（30 秒一輪，太陽弧形運動 + 天空 fog 顏色 lerp）、下雨（streak + 撞擊圓環 + 程序化雨聲）、晚上會亮的營火、跑動的動物 + 鳥群、灰塵粒子。」

【依序快速切幾個 toggle 示意】

---

## 2. Growth & Morph 模式（30 秒）

> 「切到 **Growth** mode — 樹從小苗 morph 成大樹，搭配草地跟花叢一起 reveal。**Morph** mode 是另一個版本的成長動畫，用相同的 `makeTree(rng, S)` 程序化參數做 interpolation。」

【切到 Growth，拉成長 slider】

---

## 3. Path Trace 模式（60 秒）

> 「切到 **Path Trace** — 同一個場景，用 `three-gpu-pathtracer` 做真實的 ray tracing。」

【切到 PT mode，等 BVH 建好（HUD 會顯示 building → tracing → converging → converged，spp 計數）】

> 「Path tracer 不支援 `InstancedMesh` 跟 `MeshToonMaterial`，所以進 PT 模式時我們做了幾件事：
> 1. 所有 toon material **swap** 成 `MeshStandardMaterial`，保留原本顏色
> 2. Instanced 葉子 **重建** 成靜態幾何 — 每個 sprig anchor 散 10 顆小方塊，疊出範例圖那種 voxel cluster 葉子輪廓
> 3. Path tracer 渲染到**低解析 target**（一樣 420px 高），再用我們寫的 `renderPixelBlit` shader 做 ACES tone map + 強制 nearest UV snap + sRGB encode 到 canvas
> 4. BVH 建構用 web worker 跑，所以切模式不會卡 UI」

> 「光源方面，sun 是 Three 的 `DirectionalLight`，env 是一個 procedural 的 sky map（藍色 zenith → 暖色 horizon + 太陽 disk），提供陰影區的補光。水池改成 `MeshPhysicalMaterial` 加 clearcoat，讓樹跟天空真的反射在水面上。」

【可以拖視角，PT 會 reset samples 重新累積；也可以指出地面延伸到丘陵的「無限地圖」感】

> 「同一個場景，real-time 是 cel-shaded pixel art，PT 是 ray-traced 真實光照但保留 pixel-art 解析度 — 對比起來很明顯。」

---

## 4. 收尾（15 秒）

> 「技術上整體用 **Three.js r0.171 + Vite 6**，PT 用 **three-gpu-pathtracer** 跟 **three-mesh-bvh**。整個專案分成三個資料夾：`01_webgl_tree`（real-time）、`02_tree_growth`（morph）、`03_ray_tracing`（PT），全部 share 同一棵 procedural 樹。謝謝。」

---

# 老師可能問的技術問題 — 回答 cheat sheet

### Q：你們 cel shading 怎麼做的？是 fragment shader 自己寫嗎？

> 用 Three.js 內建的 `MeshToonMaterial` + 一張 4 個顏色 stop 的 `DataTexture` 當作 gradient ramp（`NearestFilter` 才會有 stepped 效果，不會 lerp）。所有 material 共用同一張 ramp，色階一致。

### Q：低解析渲染怎麼避免 pixel swim？

> 兩段：(1) 相機沿著 view-aligned 的 texel 網格做 snap — 把 eye position 在 right/up 兩軸上 round 到 texel 大小的倍數。(2) snap 的誤差換成 sub-pixel 偏移，在 composite shader 把 sample uv 加上 `uSnapTexels`，整張畫面就會反向滑動補回去那段誤差。是 David Holland 文章裡的標準做法，但我們是自己實作。

### Q：雲影是真的雲還是 fake 的？

> Fake — procedural noise texture 在 shader 裡 scroll。我們用 Three.js 的 `onBeforeCompile` 注入到**每個** material 的 fragment shader，把 `outgoingLight` 乘上 `getCloudAttenuation(worldPos)`。所有材質共用同一個 `cloudUniforms` object 確保動畫同步。

### Q：Outline 是怎麼偵測？

> Depth + view-space normal 兩張 prepass（用 `scene.overrideMaterial = MeshNormalMaterial` 跑一次）。Outline shader 4-tap 採樣鄰居：depth 差值 > threshold 是 silhouette edge，normal dot product < threshold 是 crease edge。另外加了 cross-product convex highlight 在向光的凸邊上塗暖色 rim light。

### Q：God rays 是 volumetric 嗎？

> 不是 — screen-space 的，沒有真實 participating media。每個 pixel 朝太陽螢幕座標方向做 48-tap raymarch，撞到 depth ≈ 1（天空）就累積；再乘上垂直於光向的 sin band 函數做出條紋感。Jittered 起點避免 banding。

### Q：水池反射怎麼做？

> Real-time 是 **planar reflection** — 鏡頭沿水面鏡像翻轉再渲染一次到 RT，當作 texture 餵給水面 shader。注意要把所有 material 暫時 DoubleSide 才不會 backface culling 反轉。Path Trace 模式下沒辦法用 planar shader，所以改 `MeshPhysicalMaterial` + `clearcoat = 1.0` 給 Fresnel-based 反射 + 一張 ripple normal map 做水波。

### Q：Path Trace 用了什麼 library？支援哪些 material？

> [`three-gpu-pathtracer`](https://github.com/gkjohnson/three-gpu-pathtracer) v0.0.23，基於 WebGL2，使用 [`three-mesh-bvh`](https://github.com/gkjohnson/three-mesh-bvh) 加速 ray-mesh intersection。只支援 `MeshStandardMaterial` / `MeshPhysicalMaterial`，所以我們切進 PT 時要做 material swap；也不支援 `InstancedMesh`、`Points`、`HemisphereLight`，我們各自做了對應處理（baked geometry / 隱藏 / sky env 補光）。

### Q：BVH 建構會卡多久？怎麼避免阻塞 UI？

> 我們用 `GenerateMeshBVHWorker`（single-worker 版本，不需要 SharedArrayBuffer），整個 BVH 建構在 web worker 跑，主執行緒不會卡。HUD 顯示 building → tracing → converging → converged 的狀態。

### Q：為什麼 PT 的葉子是方塊？

> Path tracer 對薄 alpha cutout sprite 不友善（feathery 樹葉貼圖透光太多，rays 一直撞到背後的 dark interior，整個樹冠會發黑）。我們把每個原本 billboard sprite 的 anchor 位置散 10 顆小立方體（hashed jitter + 隨機 yaw），靜態幾何 path tracer 能很乾淨地算 6 個正交面的明暗 — 順便也吻合 reference image 的 Minecraft-shader voxel 葉子美術風格。

### Q：PT 的解析度怎麼跟 real-time 對齊？

> Path tracer 設定 `renderScale = settings.verticalResolution / canvasHeight`，內部 accumulation target 就是 ~420px 高的低解析。然後我們自己寫 `renderPixelBlit` shader：UV 強制 quantise 到 source texel 中心（`floor(uv * srcSize) / srcSize + 0.5`），ACES tone map + sRGB encode 到 canvas — 不靠 texture filter 設定，保證 nearest 採樣。

### Q：PT mode 切換時場景狀態怎麼還原？

> Init 時 snapshot 所有會改的 state（material、visibility、scene.fog、scene.environment、sun.position 等），存在 `_state` 物件裡。Dispose 時逐個還原 + 釋放 BVH worker / render target / generated texture。確保 mode 切回 real-time 場景完全乾淨。

### Q：你們專案分工怎麼樣？

> Real-time + Path Trace pipeline 我做的，team mate 做 Growth morph + 一些 effect（rain sound、birds、animals）。所有 mode 共用同一個 `buildWorld(scene)` 跟同一個 procedural 樹 `makeTree(rng, S)`。

---

## 講者 Tips

- **絕對要切到 PT 看一下** — 等 BVH 建好（看 HUD），spp 跳到 10-20 樣本就已經能看清，講解時可以 narrate 「現在在 accumulate，已經 30 spp」之類的
- 切 PT 之前先在 real-time 把 cycle 拖到喜歡的時段，因為 PT 是 snapshot sun（注：本 branch override 太陽方向，所以這條目前不適用）
- 拖動視角會 reset PT samples — 講完 PT 後拖一下示意 progressive refinement 的特性
- 不需要解釋每個 toggle，挑 2-3 個最戲劇化的（Night、Rain、God rays、Outlines）切就好
- 時間不夠的話，跳過 Growth/Morph 直接從 Real-time → PT，重點是「同一個場景兩種渲染風格」的對比
