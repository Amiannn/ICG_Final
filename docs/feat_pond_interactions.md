# feat/pond-interactions — 池塘互動與場景整修

本分支在 Game / Real-time 模式上新增「可以戳的場景」互動層，並整修池塘的外觀與構圖。
目標是現場 demo：**拖曳轉視角、點水起漣漪、點樹搖落葉**，一句話講完的互動模型。

## 新增功能

### 1. 點擊互動層（新檔 `01_webgl_tree/src/effects/interact.js`）

- **點水面 → 漣漪**：從點擊處擴散一圈亮環＋內圈尾波，約 1.8 秒淡出，夜晚也清楚可見。
  射線與水面平面求交後，用池塘的不規則輪廓做精確的內部判定。
- **點樹 → 搖晃＋落葉**：樹冠是 billboard 沒有真實 mesh，命中判定用「射線到樹幹軸的
  圓柱距離」。命中後樹繞基部做阻尼擺動，並從**樹冠外緣**灑出亮綠落葉（在深色樹冠前
  才看得到）。落葉用 InstancedMesh 池（42 個）回收重用，飄落時跟著場景風 uniform 漂。
- **幼樹不掉葉**：`ctx.growthReveal < 0.3`（還是光禿樹枝期）點樹只搖不掉葉；之後落葉
  數量隨生長度增加（最多 16 片）。
- 判定順序：**水面優先於樹**（樹的圓柱判定較寬鬆，腳印與池塘後岸重疊）。
- 曾實作「滑動 → 一陣風」，因與拖曳轉視角手勢衝突，**已依討論移除**；請勿在整合時撿回。

### 2. 池塘外觀（`scene/water.js`、`scene/world.js`）

- **沙岸環**：沿池塘不規則 rim 生成一圈沙灘 mesh，墊在半透明水緣下面讀作濕沙。
- **圍石**：沿 rim 擺放留缺口的石頭圈＋幾顆半沉水中的石頭打破水線。
- **水面 shader 加強**：深淺漸層（岸邊淺、中央深）、岸線白沫與 lapping、反射權重隨
  水深增加。
- **夜晚月色**：水是 ShaderMaterial 不吃場景光，新增 `uNight` uniform（= 1 −
  `lighting.dayness`，由 realtime.render 每幀餵入），夜裡整面水壓成深月色藍，
  並有一塊月光光斑（glade），波紋線在光斑中讀作月光粼粼。
- Water 類新增公開 API：`rimPoint(angle, k)`（岸線取點）、`containsPoint(x, z)`
  （輪廓內判定）、`addRipple(x, z)`（觸發點擊漣漪）。

### 3. 構圖 / Layout（`camera.js`、`scene/world.js`）

- **池塘搬家**：從樹根正前方移到樹的左前 `(4.4, 0, 6.8)`、縮為 7×5——樹不再像長在
  水裡，清楚站在自己的岸上。
- **相機 target 下移**（y 8.2 → 2.8，`camera.js` 建構子與 `drift()` 兩處）：整個場景
  在手機直式畫面上抬高，**池塘完整位於時間軸滑桿上方**，可直接點擊。
- 原本從預設視角擋住池塘左前緣的中景大石 `bigRocks (6,12)` 移到 `(-2, 13.5)`
  （預設視角外，轉視角時仍是中景量體）。

### 4. UI（`index.html`、`styles.css`、`ui.js`、`modes/game.js`、`main.js`）

- **事件 toast 移到頂部**（info card 下方）：原本在底部正好罩住池塘、還會吃掉點擊。
- **Settings → Demo →「⏩ Skip to Day 30」**：demo 快轉到滿樹（清晨），鍵盤 `F` 同效。
  action 名稱為 `skipday30`，由 game mode 處理（只會往前跳，不會倒退）。

## 整合注意事項（mode plugin 契約相關）

- `ctx.interact`：由 `main.js` 建立；`realtimeMode.render` 每幀呼叫
  `ctx.interact.update(time)`（搖樹擺動＋落葉動畫）。新模式若沿用 realtime 渲染即
  自動獲得互動；自繪的模式想要互動需自行呼叫 `update`。
- `ctx.activeTreeGroup`：「目前可以被戳的樹」。預設 = `ctx.tree`；game mode 換樹種
  （morph）時會改指到 morph group，dispose 時還原。新增樹種請記得設定它。
- **相機 target 改了**，所有模式（growth / morph 含）構圖都受影響，已逐一截圖確認
  正常；新模式不要再假設舊的 y=8.2 構圖。
- 水面反射注意：池塘已不在樹的鏡面反射帶（+x+z 對角）上，開「Water reflect」時
  倒影以天空與樹冠側緣為主，不再有完整樹倒影。預設反射關閉所以遊戲模式無感。
- Dev hooks（console 可用）：`__tod(t)` 凍結時刻（夜≈0.0、正午≈0.45）、
  `__lastTap`（最後一次點擊命中："water" / "tree" / null）、
  `__interact.debug()`（目前活著的落葉座標）。
- Game 模式時鐘 24 秒/天，自動截圖驗證請用 `?mode=realtime` + `__tod` 凍結時間。

## 檔案清單

| 檔案 | 變更 |
| --- | --- |
| `src/effects/interact.js` | 新增：點擊互動（漣漪/搖樹/落葉） |
| `src/scene/water.js` | 點擊漣漪 uniforms、深淺/泡沫/夜色 shader、rim API |
| `src/scene/world.js` | 池塘搬家縮小、沙岸環、圍石、半沉石、擋視線石頭移位 |
| `src/camera.js` | target y 8.2 → 2.8（兩處） |
| `src/main.js` | tap 判定、interact 接線、`F` 快捷鍵、`__interact` hook |
| `src/modes/realtime.js` | 每幀餵 `uNight`、呼叫 `interact.update` |
| `src/modes/game.js` | `skipday30` action、`activeTreeGroup` 維護 |
| `src/ui.js` | Skip to Day 30 按鈕接線 |
| `index.html` | toast 移出 bottom-cluster、Settings Demo 區 |
| `src/styles.css` | toast 頂部定位 |
