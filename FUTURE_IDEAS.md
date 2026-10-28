# URL-Editor - 未來功能提案與產品亮點 (Future Features & Highlights)

本文件旨在為 **URL-Editor** 專案規劃未來功能與擴充方向。鑑於本工具的核心受眾與主要使用者為 **軟體工程師與開發者 (Software Engineers & Developers)**，我們將功能規劃分為「已實作上線亮點」、「工程師核心工具」與「行銷人員專用模組（需透過開關啟用）」。

> **狀態註記（2026-10）**：
> 原訂的 Phase 1（URL Diff 比對器、Redirect Rules 重新導向產生器）、Phase 2（Cloudflare Worker + D1 端到端零知識加密雲端同步）、Phase 3（UTM 標籤產生器、批次追蹤參數清理器）、以及額外的「雙網址對照編輯工作台」、「2K/4K HiDPI 螢幕自適應排版」與「獨立資料備份中心」**皆已全數實作完成並上線**。
> 本文件目前主要作為新世代擴充構想與長期演進路線圖之規劃。

---

## 🌟 核心產品亮點總結 (Current Strengths & Deployed Features)
1. **全方位 URL 解析與重組**：精確拆解 Protocol, Domain, Path, Query Parameters 及 Hash，支援雙向即時同步編輯。
2. **⫽ 雙網址對照編輯工作台 (Dual URL Editor)**：雙欄並列即時拆解兩組 URL，支援一鍵跨欄複製與傳送參數。
3. **多維度檢視模式**：支援卡片式 (Cards)、網域群組 (Grouped) 與表格行內編輯 (Table View)。
4. **即時沙盒測試 (Live Test Sandbox)**：支援內建 HTTP 請求測試 (GET/POST/HEAD)、自訂 Headers/Body 與即時狀態診斷。
5. **端到端加密零知識雲端同步 (Zero-Knowledge E2EE Cloud Sync)**：客戶端 PBKDF2 + AES-GCM 256-bit 加密，Cloudflare D1 儲存，HTTP ETag / If-Match 樂觀鎖與智慧三方合併。
6. **2K / 4K HiDPI 螢幕自適應排版**：以 16px/1rem 為基準，支援小/標準/大/特大 4 級縮放，徹底解決現代高解析度螢幕閱讀體驗。
7. **極致的使用者體驗**：支援繁體中文與英文雙語、深色/亮色高對比模式 (Dark/Light Mode)、獨立資料備份中心 (JSON/CSV) 與即時健康狀態檢查。

---

## 🛠️ 開發者核心工具演進 (Developer-Centric Features)

### 1. 🔍 網址比對與差異分析器 (URL Diff & Comparison Tool) [✅ 已實作上線]
* **已實作功能**：支援左右雙欄輸入或從清單選取兩個 URL，以色彩標記（綠色新增、紅色刪除、黃色修改）精確比對 Domain、Path 及 Query 差異。

### 2. 🔄 伺服器重新導向規則產生器 (Redirect Rules & Regex Generator) [✅ 已實作上線]
* **已實作功能**：輸入舊網址與新網址，一鍵產生 **Nginx**、**Apache (.htaccess)**、**Cloudflare Workers** 或 **Vercel (`vercel.json`)** 的重新導向規則與 Regular Expression (Regex)，並支援 Query 參數轉發。

### 3. ☁️ 端到端加密零知識雲端同步 (Zero-Knowledge E2EE Cloud Sync) [✅ 已實作上線]
* **已實作功能**：以 Google OAuth 登入，於瀏覽器端使用 Web Crypto API 進行 AES-GCM 256-bit 加密，密文存放於 Cloudflare D1，並透過 ETag / If-Match 樂觀鎖杜絕並發衝突。

### 4. 📦 OpenAPI / Swagger 3.0 / Postman 集合一鍵匯入與端點預覽 [💡 未來規劃]
* **痛點**：後端開發者或前端對接時，常有整份 API Spec (Swagger JSON 或 Postman Collection) 需要測試與拆解。
* **功能設計**：支援貼上或上傳 OpenAPI v3 / Postman v2.1 規格檔，自動萃取所有 Endpoints 與 Query Parameters 轉為卡片清單，可直接在 URL Editor 中微調與沙盒發送測試。

### 5. 📱 Deep Link / Universal Links / App Scheme 深度鏈接除錯與解析器 [💡 未來規劃]
* **痛點**：App 開發者常需處理複雜的自訂 Scheme（如 `myapp://path?param=1`）、Android Intent Scheme 或 iOS Universal Links。
* **功能設計**：解析非 HTTP(S) 之各類行動協定，自動分析 package id、fallback url 與 base64 payload，並支援產生測試 QR Code 讓手機 App 直接捕捉觸發。

### 6. ⚡ URL-Editor CLI 終端指令行工具 [💡 未來規劃]
* **痛點**：DevOps 與測試團隊希望在 CI/CD pipeline 中自動驗證產品線幾十組 URL 是否符合規範或健康度。
* **功能設計**：發布輕量級 npm package（如 `npx @url-editor/cli check urls.json`），支援本地端連通性探測、轉址規則驗證與輸出報表。

---

## 📢 行銷人員專用模組 (Marketing Toolkit - Feature Flag Controlled)

*(預設隱藏，需在「設定」中手動開啟「行銷工具箱」才會顯示，保持主介面純粹)*

### 1. 🎯 智慧型 UTM 參數產生器與行銷預設集 (Advanced UTM Builder & Presets) [✅ 已實作上線]
* **已實作功能**：內建 Google Ads、FB 廣告、電子報 EDM 常用活動範本，支援 `utm_source`、`utm_medium`、`utm_campaign` 等標準欄位組合、自動編碼與驗證。

### 2. 🧹 批次追蹤參數清理器 (Batch Tracker Stripper & Privacy Sanitizer) [✅ 已實作上線]
* **已實作功能**：批次貼入多個網址，一鍵智慧識別並移除 `fbclid`、`gclid`、`msclkid`、`utm_*` 等數十種廣告追蹤碼，還原純淨 URL 並嚴格保留業務 Query。

### 3. 🎨 進階 QR Code 品牌化與設計 (Brandable QR Code Customization) [✅ 已實作上線]
* **已實作功能**：純本地 Canvas 繪製，支援自訂前背景色彩、高解析度下載，無需外部第三方 API，確保資料隱私與離線可用性。

---

## 👥 團隊協作與進階雲端功能 (Team Workspaces & Cloud Extensions) [💡 長期規劃]

### 1. 🔐 端到端加密團隊工作區 (Encrypted Team Workspaces)
* **痛點**：跨部門團隊（例如 QA 與前端）常需要共享同一批測試環境網址與自訂參數包。
* **功能設計**：建立共享加密群組，各成員使用團隊公鑰加密網址資料，支援唯讀邀請與同步更新。

---

## 📊 實施藍圖與狀態 (Roadmap & Status)

| 階段 | 模組分類 | 包含功能 | 目標受眾 | 目前狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | 開發者核心 | 網址比對 (URL Diff) + 重新導向規則產生器 | 軟體工程師 | **✅ 已完成並上線** |
| **Phase 2** | 開發者核心 | 端到端加密雲端同步 (E2EE + Cloudflare D1) | 軟體工程師 | **✅ 已完成並上線** |
| **Phase 3** | 行銷工具箱 | 追蹤參數清理器 + UTM 產生器 + 品牌 QR Code | 行銷人員 / 業務 | **✅ 已完成並上線** |
| **Phase 4** | 雙欄工作台 | 雙網址對照與跨欄參數轉移工作台 (Dual URL Editor) | 軟體工程師 / QA | **✅ 已完成並上線** |
| **Phase 5** | 介面與體驗 | 2K/4K HiDPI 字體階梯縮放 + 獨立設定資料備份中心 | 全體使用者 | **✅ 已完成並上線** |
| **Phase 6** | 系統健全度 | WCAG AA 亮色高對比度 + 全域非同步例外防禦強化 | 全體使用者 | **✅ 已完成並上線** |
| **Phase 7** | 延伸生態系 | OpenAPI / Swagger 匯入 + Deep Link 測試器 + CLI 工具 | 開發者 / DevOps | 💡 未來評估與規劃 |
