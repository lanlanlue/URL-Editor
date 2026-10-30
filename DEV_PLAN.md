# URL-Editor - 進階詳細開發計畫書 (Production-Grade Development Plan)

本文件為 **URL-Editor** 專案的完整技術開發藍圖，涵蓋檔案路徑規範、核心資料合約、錯誤處理機制、Feature Flag 狀態管理以及 CI/CD 整合細節。

> **狀態註記（2026-10）**：全階段功能（Phase 0 至 Phase 6）已全部開發完成、經單元測試驗證通過並正式部署上線於 [`https://url-editor.ointw.com`](https://url-editor.ointw.com)。
> 包含 Google OAuth 登入、Cloudflare Worker + D1 端到端加密零知識同步 (E2EE)、雙網址對照工作台、URL Diff、重新導向規則產生器、行銷工具箱 (UTM/Tracker Stripper)、2K/4K HiDPI 字體階梯縮放系統、WCAG AA 對比度強化與獨立資料備份中心。

---

## 📁 目錄結構與架構規範 (Module Architecture)
```text
src/
├── js/
│   ├── core/
│   │   ├── urlParser.js           # URL 解析與組裝核心
│   │   ├── urlDiff.js             # [Phase 1] 網址語意化差異比對核心
│   │   ├── redirectGenerator.js   # [Phase 1] 伺服器重新導向規則核心
│   │   ├── cloudApi.js            # [Phase 2] Cloudflare D1 雲端 API Client (ETag / If-Match)
│   │   ├── cryptoVault.js         # [Phase 2] Web Crypto 端到端零知識加密 (PBKDF2 + AES-GCM)
│   │   ├── secureStorage.js       # [Phase 2] 安全金鑰與本地憑據隔離管理
│   │   ├── syncMerge.js           # [Phase 2] 雙向差異比對與三方合併引擎
│   │   ├── agentBridge.js         # [Agent] 選用的 LLM 維護介面 (window.urlEditorAgent)
│   │   ├── agentRelayClient.js    # [Agent] 頁面端 long-poll 客戶端，連本機中繼
│   │   ├── trackerStripper.js     # [Phase 3] 追蹤參數過濾核心
│   │   ├── utmBuilder.js          # [Phase 3] UTM 組合核心
│   │   └── settings.js            # [Phase 0] 全域偏好設定與 Feature Flag 管理
│   ├── ui/
│   │   ├── components/
│   │   └── modals/
│   │       ├── urlDiffModal.js        # [Phase 1] 網址比對視窗
│   │       ├── redirectModal.js       # [Phase 1] 重新導向規則視窗
│   │       ├── cloudSyncModal.js      # [Phase 2] 雲端帳號與同步管理視窗
│   │       ├── batchStripperModal.js  # [Phase 3] 批次追蹤參數清理視窗
│   │       ├── utmModal.js            # [Phase 3] UTM 參數產生器視窗
│   │       ├── dualEditorModal.js     # [Phase 4] 雙網址對照與跨欄參數編輯工作台
│   │       └── settingsModal.js       # [Phase 5] 包含資料備份中心 (JSON/CSV) 與 HiDPI 縮放設定
├── agent-relay/               # [Agent] 本機中繼 + MCP stdio server（Node，CommonJS，零依賴）
│   ├── relay.cjs
│   ├── mcp.cjs
│   └── cli.cjs
├── server/
│   ├── auth.js                # Cloudflare Worker Google OAuth 驗證
│   └── storage.js             # D1 SQL 儲存與並發版本控制
└── worker.js                  # Cloudflare Worker 主路由入口
```

---

## 🏗️ Phase 0：設定開關與架構基礎 [已完成並上線 (Completed & In Production)] (Feature Flag & Settings Architecture)

* **Step 0.1：擴充設定管理模組 (`src/js/core/settings.js`)**
  * 定義預設設定結構：
    ```javascript
    export const DEFAULT_SETTINGS = {
      theme: 'dark',
      enableMarketingToolkit: false, // 預設關閉行銷工具
      cloudSyncProvider: 'none',     // 'none' | 'gist' | 'webdav'
    };
    ```
  * 實作 `loadSettings()` 與 `saveSettings(newSettings)`，採用 `localStorage` 進行持久化，並加入 `try/catch` 防止解析崩潰。
* **Step 0.2：擴充設定對話框 UI (`src/js/ui/modals/settingsModal.js`)**
  * 新增「行銷工具箱 (Marketing Toolkit)」開關項目：
    ```html
    <label class="setting-item">
      <span>啟用行銷工具箱 (UTM, Tracker Stripper)</span>
      <input type="checkbox" id="marketing-toolkit-toggle" />
    </label>
    ```
  * 綁定 `change` 事件，當切換時即時呼叫 `saveSettings()` 並觸發全域 UI 重新渲染 (re-render / DOM toggle)。
* **Step 0.3：條件式導航與模組載入 (`src/js/main.js`)**
  * 根據 `settings.enableMarketingToolkit` 的狀態，動態決定是否在主選單 (Header / Navbar) 渲染行銷相關的 Modal 入口按鈕。

---

## 🛠️ Phase 1：開發者核心工具 [已完成並上線 (Completed & In Production)] (Developer-Centric Core Tools)

### 1.1 🔍 網址比對與差異分析器 (URL Diff & Comparison Tool)
* **Step 1.1.1：核心比對演算法 (`src/js/core/urlDiff.js`)**
  * 輸入：`urlA` (String), `urlB` (String)
  * 輸出結構：
    ```javascript
    {
      domainChanged: boolean,
      pathChanged: boolean,
      addedParams: { [key]: value },
      removedParams: { [key]: value },
      modifiedParams: { [key]: { oldVal, newVal } }
    }
    ```
* **Step 1.1.2：單元測試 (`src/js/core/urlDiff.test.js`)**
  * 涵蓋：相同 URL、部分 Query 變更、網域/協定變更、空字串或無效 URL 例外處理。
* **Step 1.1.3：比對 UI 元件 (`src/js/ui/modals/urlDiffModal.js`)**
  * 雙欄輸入設計，支援即時比對。差異處使用色彩高亮（綠色表示新增、紅色表示刪除、黃色表示修改）。

### 1.2 🔄 重新導向規則產生器 (Redirect Rules & Regex Generator)
* **Step 1.2.1：規則轉換核心 (`src/js/core/redirectGenerator.js`)**
  * 支援 4 種輸出格式：
    1. **Nginx**：`rewrite ^/old-path$ https://domain.com/new-path permanent;`
    2. **Apache**：`Redirect 301 /old-path https://domain.com/new-path`
    3. **Cloudflare Workers**：`if (url.pathname === '/old-path') { return Response.redirect('...', 301); }`
    4. **Vercel (`vercel.json`)**：`{ "source": "/old-path", "destination": "...", "permanent": true }`
* **Step 1.2.2：單元測試 (`src/js/core/redirectGenerator.test.js`)**
  * 驗證萬用字元 (Wildcard `*`) 與 Query 參數保留規則的正確性。
* **Step 1.2.3：規則產生器 UI (`src/js/ui/modals/redirectModal.js`)**
  * 選擇輸出格式的 Tabs / Dropdown，提供一鍵複製按鈕與成功 Toast 提示。

---

## ☁️ Phase 2：進階開發者工具與零知識端到端雲端同步 [已完成並上線 (Completed & In Production)]

### 2.1 🔌 瀏覽器擴充功能支援 (Web Extension v3 Packaging)
* **Step 2.1.1：建立 `src/static/manifest.json`**
  ```json
  {
    "manifest_version": 3,
    "name": "URL Editor",
    "version": "2.1.3",
    "action": { "default_popup": "index.html" },
    "permissions": ["activeTab", "storage"]
  }
  ```
* **Step 2.1.2：分頁 URL 自動載入邏輯 (`src/js/core/extensionBridge.js`)**
  * 檢查是否執行於 Chrome Extension 環境 (`typeof chrome !== 'undefined' && chrome.tabs`)。若是，則自動呼叫 `chrome.tabs.query` 取得當前分頁 URL 填入編輯器。

### 2.2 ☁️ 端到端加密零知識雲端同步模組 (Zero-Knowledge E2EE Cloud Sync via Cloudflare D1)
* **Step 2.2.1：加密與金鑰衍生核心 (`src/js/core/cryptoVault.js`, `src/js/core/secureStorage.js`)**
  * 採用 Web Crypto API 原生實作 PBKDF2 (100,000 次疊代) 金鑰衍生與 AES-GCM 256-bit 密文加密。
  * 產生符合 BIP-39 標準的 24 字詞安全還原金鑰 (Recovery Key)，在客戶端完全解鎖前伺服器無從讀取明文。
* **Step 2.2.2：雲端資料庫 API 與並發衝突解決 (`src/js/core/cloudApi.js`, `src/js/core/syncMerge.js`)**
  * 基於 HTTP `ETag` 與 `If-Match` 樂觀鎖 (Optimistic Concurrency Control) 機制，徹底杜絕多裝置並發寫入覆蓋與競爭冒險 (Race Condition)。
  * 提供智慧型三方合併 (Three-Way Merge) 引擎，自動比對各裝置最新修改時間並平滑保留資料。
* **Step 2.2.3：後端 Worker 與 D1 SQL 引擎 (`src/worker.js`, `src/server/`)**
  * 以 Cloudflare Workers + D1 資料庫提供超低延遲全球邊緣運算 API，完整通過 Google OAuth 安全驗證。

---

## 📢 Phase 3：行銷人員專用模組 [已完成並上線 (Completed & In Production)] (Marketing Toolkit - Feature Flagged)
*(依賴 `settings.enableMarketingToolkit === true`)*

### 3.1 🧹 批次追蹤參數清理器 (Batch Tracker Stripper)
* **Step 3.1.1：過濾核心 (`src/js/core/trackerStripper.js`)**
  * 預設黑名單：`fbclid`, `gclid`, `dclid`, `msclkid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `_hsenc`, `__hssc`, `__hstc`, `hsCtaTracking`, `mc_cid`, `mc_eid`.
  * 實作 `stripTrackers(url)` 與 `batchStrip(urlList)`。
* **Step 3.1.2：單元測試 (`src/js/core/trackerStripper.test.js`)**
  * 確保合法業務參數（如 `user_id=123`）不會被誤刪。
* **Step 3.1.3：UI (`src/js/ui/modals/batchStripperModal.js`)**

### 3.2 🎯 智慧型 UTM 參數產生器 (Advanced UTM Builder)
* **Step 3.2.1：UTM 組合核心與預設集 (`src/js/core/utmBuilder.js`)**
* **Step 3.2.2：UI (`src/js/ui/modals/utmModal.js`)**

### 3.3 🎨 進階 QR Code 品牌化 (Brandable QR Code)
* **Step 3.3.1：升級 `src/js/utils/qrCodeGenerator.js`**
  * 支援顏色自訂與中央 Logo 繪製（透過 Canvas API）。

---


---

## ⫽ Phase 4：雙網址對照編輯工作台 (Dual URL Editor Modal) [已完成並上線 (Completed & In Production)]

* **Step 4.1：同畫面雙欄並列架構 (`src/js/ui/modals/dualEditorModal.js`)**
  * 支援獨立拆解 URL A 與 URL B 的 Protocol、Host、Path 與 Query 參數。
  * 支援「一鍵載入主編輯器網址」與「已儲存卡片下拉選單載入」。
* **Step 4.2：跨欄參數傳送與動態同步**
  * 每一列 Query 參數均具備「➡️ / ⬅️ 跨欄傳送」按鈕與值單獨複製晶片。
  * 支援自由拖曳縮放（Resize Handle）與全螢幕最大化切換，內建草稿防誤觸關閉機制。

---

## 🖥️ Phase 5：2K/4K HiDPI 螢幕自適應與設定資料備份中心 [已完成並上線 (Completed & In Production)]

* **Step 5.1：HiDPI Rem Typography 字體階梯縮放系統 (`src/css/modules/typography.css`)**
  * 全面重構 CSS 為 `rem` 單位，並將基礎字體大小自傳統 14px 調升為現代 2K/4K 螢幕主流之 `16px`。
  * 支援 **小 (Small / 14px)**、**標準 (Medium / 16px)**、**大 (Large / 18px)**、**特大 (Extra Large / 20px)** 4 級無段縮放切換，並自動持久化於設定中。
  * 進行彈性容器（Flex-wrap, Overflow ellipsis, Min-width 36px）排版防禦，確保在特大字體下卡片操作鈕不跑版、不溢出。
* **Step 5.2：獨立資料備份中心 (`src/js/ui/modals/settingsModal.js`)**
  * 將主工具列低頻之「JSON 匯入/匯出」與「CSV 匯入/匯出」功能從快速工具列解耦，移入「設定對話框」之獨立「資料備份中心 (Data Backup Center)」區塊。
  * 淨化主操作介面，聚焦於 URL 高頻操作與即時沙盒測試。

---

## 🛡️ Phase 6：系統健全度、WCAG AA 視覺對比與例外防禦 [已完成並上線 (Completed & In Production)]

* **Step 6.1：亮色主題對比度優化 (`src/css/modules/controls.css`, `main.css`)**
  * 重構清單視圖模式切換（Cards / Table / Grouped）之分段控制鈕 (Segmented Control)。
  * 亮色模式下被選中項目改以主強調色 (`--primary: #2563eb`) 填充搭配高對比白字 (`#ffffff`)，未選中項搭配微淡背景與清晰邊界，符合 WCAG AA 視覺可訪問性標準。
* **Step 6.2：例外處理防禦與離線安全**
  * 對所有非同步操作（即時沙盒測試、連通性探測、批次網域替換）強化錯誤捕捉與使用者友善 Toast 提示。
  * 雲端同步加入 10 秒超時終止與離線自動降級機制，保證離線狀態下全功能正常操作。

## 🧪 Phase 7：測試、品質與 CI/CD 整合 (QA & CI/CD Pipeline)

* **Step 4.1：擴充 Jest 測試涵蓋率**
  * 確保所有新增的 `*.test.js` 檔案皆加入 Jest 執行流程 (`jest.config.js`)。
* **Step 4.2：GitHub Actions CI 檢查 (`.github/workflows/ci.yml`)**
  * 確認 CI 流程在每次 Push / PR 時自動執行：
    1. `npm ci`
    2. `npm run lint`
    3. `npm test`
    4. `npm run build`
* **Step 4.3：最終驗證清單**
  * 執行 `npm run test:coverage` 確保測試覆蓋率無明顯下降。
  * 檢查 Feature Flag 關閉時，行銷模組未載入且主介面效能不受影響。
