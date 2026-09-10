# URL-Editor - 未來功能提案與產品亮點 (Future Features & Highlights)

本文件旨在為 **URL-Editor** 專案規劃未來功能與擴充方向。鑑於本工具的核心受眾與主要使用者為 **軟體工程師與開發者 (Software Engineers & Developers)**，我們將功能規劃分為「工程師核心工具」與「行銷人員專用模組（需透過開關啟用）」。

> **狀態註記（2026-09）**：雲端同步已改採 Web-only 的 Google OAuth + Cloudflare
> D1 + 前端端到端加密。下方舊有 Gist / WebDAV / Supabase 構想保留作歷史記錄，
> 不代表目前產品會提供 Gist token 同步入口。

---

## 🌟 核心產品亮點總結 (Current Strengths)
1. **全方位 URL 解析與重組**：精確拆解 Protocol, Domain, Path, Query Parameters 及 Hash，支援雙向即時同步編輯。
2. **多維度檢視模式**：支援卡片式 (Cards)、網域群組 (Grouped) 與表格行內編輯 (Table View)。
3. **即時沙盒測試 (Live Test Sandbox)**：支援內建 HTTP 請求測試 (GET/POST/HEAD)、自訂 Headers/Body 與即時狀態診斷。
4. **極致的使用者體驗**：支援繁體中文與英文雙語、深色模式切換 (Dark/Light Mode)、批次匯入/匯出與即時健康狀態檢查。

---

## 🛠️ 開發者核心工具 (Developer-Centric Core Features)
*專為工程師與技術人員打造，聚焦於除錯、架構與開發效率。*

### 1. 🔍 網址比對與差異分析器 (URL Diff & Comparison Tool)
* **痛點**：開發者常需比較兩個相似的 URL（例如 Staging vs. Production，或是不同的 API 端點與參數）。
* **功能設計**：支援左右雙欄輸入或從清單選取兩個 URL，自動高亮顯示 Domain、Path 及 Query 參數的差異。

### 2. 🔄 重新導向規則產生器 (Redirect Rules & Regex Generator)
* **痛點**：網址結構變更後，開發者需要為伺服器或 CDN 編寫重定向規則。
* **功能設計**：輸入舊網址與新網址，一鍵產生 **Nginx**、**Apache (.htaccess)**、**Cloudflare Workers** 或 **Vercel (`vercel.json`)** 的重新導向規則與 Regular Expression (Regex)。

### 3. ☁️ 輕量雲端同步與備份 (Cloud Sync & Gist / WebDAV)
* **痛點**：資料目前僅存於 `localStorage`，跨裝置同步需求。
* **功能設計**：支援選擇性透過 GitHub Gist、WebDAV 或 Supabase 進行雲端同步與備份。

### 4. 🔌 現代化瀏覽器擴充功能回歸 (Web Extension v3)
* **痛點**：工程師希望在瀏覽器分頁中隨時一鍵抓取當前 URL 進行測試。
* **功能設計**：將工具打包為 Chrome/Firefox Extension Popup，支援一鍵擷取當前分頁 URL 載入編輯器。

---

## 📢 行銷人員專用模組 - 需透過開關啟用 (Marketing Toolkit - Feature Flag Controlled)
*為避免幹擾以工程師為核心的簡潔介面，行銷相關功能預設為隱藏，需在設定中手動開啟「行銷工具箱 (Marketing Mode)」才會顯示。*

### 1. 🎯 智慧型 UTM 參數產生器與行銷預設集 (Advanced UTM Builder & Presets)
* **痛點**：行銷人員需手動填寫複雜的活動追蹤參數。
* **功能設計**：建立「行銷活動範本 (Google Ads, FB 廣告, EDMs)」，支援參數自動小寫與編碼驗證。

### 2. 🧹 批次追蹤參數清理器 (Batch Tracker Stripper & Privacy Sanitizer)
* **痛點**：分享網址時需去除冗長的追蹤碼（`fbclid`, `gclid`, `utm_*`）。
* **功能設計**：批次貼入多個網址，一鍵自動過濾並移除追蹤參數，保留乾淨的原始網址。

### 3. 🎨 進階 QR Code 品牌化與設計 (Brandable QR Code Customization)
* **痛點**：行銷推廣需要更具視覺吸引力的 QR Code。
* **功能設計**：自訂前背景色、圓角點陣、中央嵌入品牌 Logo，並支援 SVG/PNG 高解析度下載。

---

## ⚙️ 架構設計原則：功能開關 (Feature Flag Architecture)
* **設計理念**：
  * **極簡預設 (Minimalist by Default)**：保持主介面純粹為 URL 解析與測試工具，避免介面過度複雜。
  * **設定開關 (Settings Toggle)**：在設定選單 (Settings Modal) 中新增 `[ ] 啟用行銷工具箱 (Enable Marketing Toolkit)` 開關。
  * **狀態持久化**：使用 `localStorage` 記錄使用者的開關偏好。當開關關閉時，行銷相關的 UI 頁籤與按鈕完全隱藏；開啟時則動態載入對應模組。

---

## 📊 實施藍圖 (Roadmap)

| 階段 | 模組分類 | 包含功能 | 目標受眾 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | 開發者核心 | 網址比對 (URL Diff) + 重新導向規則產生器 | 軟體工程師 |
| **Phase 2** | 開發者核心 | 瀏覽器擴充功能 (Web Extension) + 雲端同步 | 軟體工程師 |
| **Phase 3** | 行銷工具箱 | 追蹤參數清理器 + UTM 產生器 + QR Code 自訂 (需透過開關啟用) | 行銷人員 / 業務 |
