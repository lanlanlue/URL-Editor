# URL-Editor - 進階詳細開發計畫書 (Production-Grade Development Plan)

本文件為 **URL-Editor** 專案的完整技術開發藍圖，涵蓋檔案路徑規範、核心資料合約、錯誤處理機制、Feature Flag 狀態管理以及 CI/CD 整合細節。

> **狀態註記（2026-09）**：雲端同步部分已由 Google OAuth + Cloudflare Pages
> Functions + D1 + 前端端到端加密方案取代。原本 Phase 2.2 的 GitHub Gist token
> 同步不再是實作目標；目前以專案根目錄的 `wrangler.toml`、`migrations/`、
> `functions/` 與 `src/server/` 為正式雲端架構。

---

## 📁 目錄結構與架構規範 (Module Architecture)
```text
src/
├── js/
│   ├── core/
│   │   ├── urlParser.js
│   │   ├── urlDiff.js             # [New Phase 1] 網址比對核心
│   │   ├── redirectGenerator.js   # [New Phase 1] 重新導向規則核心
│   │   ├── trackerStripper.js     # [New Phase 3] 追蹤參數過濾核心
│   │   ├── utmBuilder.js          # [New Phase 3] UTM 組合核心
│   │   ├── cloudSync.js           # [New Phase 2] 雲端同步核心
│   │   └── settings.js            # [New Phase 0] 設定與 Feature Flag 管理
│   ├── ui/
│   │   ├── components/
│   │   └── modals/
│   │       ├── urlDiffModal.js        # [New Phase 1]
│   │       ├── redirectModal.js       # [New Phase 1]
│   │       ├── cloudSyncModal.js      # [New Phase 2]
│   │       ├── batchStripperModal.js  # [New Phase 3]
│   │       ├── utmModal.js            # [New Phase 3]
│   │       └── settingsModal.js       # [New Phase 0] 擴充設定介面
```

---

## 🏗️ Phase 0：設定開關與架構基礎 (Feature Flag & Settings Architecture)

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

## 🛠️ Phase 1：開發者核心工具 (Developer-Centric Core Tools)

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

## ☁️ Phase 2：進階開發者工具與雲端備份

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

### 2.2 ☁️ 雲端同步模組 (Cloud Sync via GitHub Gist)
* **Step 2.2.1：Gist API 整合核心 (`src/js/core/cloudSync.js`)**
  * 實作 `uploadToGist(token, urlsData)` 與 `downloadFromGist(token, gistId)`。
  * 加上 10 秒逾時處理 (AbortController) 與詳細的網路錯誤提示。
* **Step 2.2.2：同步狀態 UI (`src/js/ui/modals/cloudSyncModal.js`)**
  * 提供 Token 輸入框、Gist ID 綁定、手動「立即同步」與「從雲端還原」按鈕。

---

## 📢 Phase 3：行銷人員專用模組 (Marketing Toolkit - Feature Flagged)
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

## 🧪 測試、品質與 CI/CD 整合 (QA & CI/CD Pipeline)

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
