# URL-Editor

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/lanlanlue/URL-Editor/main.yml?branch=main)](https://github.com/lanlanlue/URL-Editor/actions)

一個輕量級、功能極其豐富的 URL 編輯、維護與管理工具。它可以將 URL 解析成各個組成部分，提供高頻編輯晶片、參數預設包、批次貼上匯入、批次網域維護、Domain 分組、連通性檢查與 QR Code 生成，幫助工程師與測試團隊極致提升工作效率。

---

## 🚀 線上預覽 (Live Demo)

您可以直接在線上體驗這個工具：

**[點擊這裡前往線上版](https://lanlanlue.github.io/URL-Editor/)**

GitHub Pages 版本是純本機模式。完整的 Google OAuth、端到端加密同步版本部署於
[`https://url-editor.ointw.com`](https://url-editor.ointw.com)；GitHub Gist 同步已移除。

---

## ✨ 核心功能特色

### ⚡ 1. 高效 URL 解析與編輯

- **自動拆解與組裝**：自動拆解 Protocol、Host、Path 與 Query 參數，並即時重組語法。
- **快捷切換晶片 (Switcher Chips)**：
  - **協定**：`http ↔ https` 一鍵切換。
  - **Port**：`:3000` / `:8080` / `:5000` 快捷切換。
  - **環境**：`dev` / `qa` / `staging` / `prod` 域名環境標籤動態切換。
- **常用參數預設包 (Query Parameter Presets)**：提供一鍵套用 Query 參數組，並支援自訂參數包的新增、編輯、刪除與管理。
- **重組歷史還原 (Rebuild History)**：自動保留最近 10 筆重組網址，下拉選單 1 鍵還原。
- **⫽ 雙網址對照編輯工作台 (Dual URL Editor Modal)**：
  - 同畫面雙欄並列拆解兩組不同的 URL（URL A / URL B），直觀對照與自由複製貼上。
  - 支援「一鍵載入主編輯器網址」與「已儲存卡片下拉載入」。
  - 參數列提供「一鍵複製值」、「➡️/⬅️ 跨欄傳送參數」與即時重組預覽。
  - 視窗支援自由拖曳縮放（Resize）與全螢幕最大化（`🗖`），並具備草稿防誤觸保留機制。

### 🔍 2. 開發者進階工具 (Developer Advanced Tools)

- **🔍 語意化網址比對分析 (URL Diff)**：
  - 雙欄即時語意化解析兩組 URL，以色彩標記（綠色新增、紅色刪除、黃色修改）精確比對 Domain、Path 與 Query 差異。
  - 支援從既有網址清單下拉快速載入對照。
- **🔄 伺服器重新導向規則產生器 (Redirect Rules & Regex)**：
  - 自動生成 **Nginx** (`rewrite`)、**Apache** (`Redirect 301`)、**Cloudflare Workers** (`Response.redirect`) 與 **Vercel** (`vercel.json`) 規則。
  - 支援萬用字元 (`*`) 與 Regex 正規表達式語法自動轉換，並自動保持 Query 參數轉發。

### 📢 3. 行銷與隱私工具箱 (Marketing Toolkit - Feature Flagged)

*(可在「設定」中一鍵啟用或關閉，維持工程師簡潔首頁體驗)*
- **🧹 批次追蹤參數清理器 (Batch Tracker Stripper)**：
  - 智慧辨識並批次剝離 `fbclid`、`gclid`、`msclkid`、`utm_*`、`_hsenc` 等數十種廣告追蹤參數，還原乾淨原始網址。
  - 嚴格保留合法的業務 Query 參數。
- **🎯 智慧型 UTM 標籤產生器 (Advanced UTM Builder)**：
  - 標準化建構 `utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`。
  - 內建 Google Ads、Facebook、電子報 (EDM) 常用行銷範本，支援自動編碼與一鍵套用。
- **🎨 進階品牌化 QR Code (Brandable QR Code)**：
  - 支援前景/背景色彩客製化、高解析度 Canvas 繪製，無須呼叫外部 API，離線極速產生。

### 📋 4. 智慧 URL 清單與多重視圖

- **多維排序與星號釘選**：
  - **排序方式**：使用頻率 (🔥)、最近使用 (🕒)、建立時間 (🆕)、名稱 A-Z (🔤)。
  - **⭐ 常用釘選**：將重要 URL 釘選置頂並強調視覺外框。
- **三大視圖模式**：
  - **📋 卡片清單 (Cards View)**：直觀卡片檢視與快速操作。
  - **📊 表格清單 (Table View)**：高密度表格視圖，支援行內直接編輯名稱與標籤、快速複製與狀態查看。
  - **📁 Domain 分組 (Grouped Accordion)**：按網域 (Host) 自動歸類與折疊面板，支援全展開與全收合。
- **⚡ 即時測試沙盒 (Live Test Modal)**：支援在應用內發送 HTTP 請求 (GET/POST/HEAD)、自訂 Headers 與 Payload、即時檢視 Response 狀態、耗時與 JSON 回應。
- **📱 行動裝置測試 QR Code**：純 JS HTML5 Canvas 繪製，無第三方依賴，手機相機直接掃描測試。
- **📡 網址連線檢查 (Health Check)**：使用者點擊觸發非同步超時探測，即時標示 🟢 線上 / 🔴 無法連線 燈號。
- **🏷️ 標籤集中管理器 (Tag Manager Modal)**：全域檢視標籤使用筆數，支援一鍵全域「重命名」或「刪除標籤」。
- **🎨 離線安全 Favicon**：使用本地 SVG 佔位圖，不會為每個 URL 探測 `/favicon.ico` 或呼叫第三方代理。

### 🛠️ 5. 大量維護與資料備份中心

- **🛠️ 批次維護工具 Modal**：
  - 批次替換 Domain（自動比對舊 Domain 並更換）。
  - 關鍵字搜尋與取代（支援 URL/標籤全域替換與 Match Case）。
  - 重複項目清理（自動偵測重複網址並一鍵保留最新）。
- **📥 智慧批次貼上匯入 Modal**：
  - 支援一次貼上多列 URL、Markdown 連結 `[標籤](網址)` 或 CSV 內容。
  - 自動分析建議名稱與分類環境標籤，提供動態勾選與表格編輯預覽。
- **⚙️ 設定與資料備份中心 (Settings & Data Backup Center)**：
  - 為了保持主操作列高頻工具的專注與俐落，JSON 與 CSV 匯入/匯出功能獨立整合於設定面板中的「資料備份中心」。
  - **JSON 備份與還原**：完整保留 URL 清單、自訂標籤、自訂參數包與使用者偏好設定。
  - **RFC 4180 CSV 匯出與匯入**：完美相容 Microsoft Excel、Numbers 與 Google Sheets，便於報表整理與大量維護。

### 🖥️ 6. 現代化介面、HiDPI 適配與多語系

- **🖥️ 2K / 4K HiDPI 螢幕自適應排版 (HiDPI Rem Typography)**：
  - 以 `16px = 1rem` 現代高解析度標準為基準，介面文字清晰舒適。
  - 提供 **小 (Small / 14px)**、**標準 (Medium / 16px)**、**大 (Large / 18px)**、**特大 (Extra Large / 20px)** 4 級字體大小無級縮放切換。
  - 彈性排版（Flex-wrap、Min-width 與溢出安全省略），即使在特大字體下操作按鈕與清單亦保持完美不跑版。
- **🎨 亮色與深色主題優化 (Dark & Light Mode)**：
  - 全新高對比度分段控制按鈕（Segmented Controls），確保亮色主題被選取項（主色調藍底白字）與未選取項清晰分明。
  - 完全符合 WCAG AA 視覺對比度標準。
- **多國語言 (i18n)**：繁體中文 (`zh-TW`) 與英文 (`en`) 完整無縫切換。

---

## 🔧 本地開發

請依照以下步驟設定您的開發環境：

1. **Clone** 本儲存庫至本地：
   ```bash
   git clone https://github.com/lanlanlue/URL-Editor.git
   ```
2. 進入專案目錄：
   ```bash
   cd URL-Editor
   ```
3. 安裝專案依賴：
   ```bash
   npm install
   ```
4. 啟動開發伺服器：
   ```bash
   npm start
   ```
   在瀏覽器中開啟 `http://localhost:1234` 即可開始開發體驗。
5. 執行單元與整合測試：
   ```bash
   npm test
   ```
6. 正式發佈打包：
   ```bash
   npm run build
   ```
   GitHub Pages 本機版使用 `npm run build:gh`；此建置不包含登入頁、OAuth、D1 API
   或雲端同步 chunk。

### Cloudflare 同步部署

雲端版本使用 Cloudflare Worker、Static Assets 與 D1。先建立 D1 資料庫並將資料庫 ID
填入 `wrangler.toml`，再套用 migration：

```bash
npx wrangler d1 migrations apply url-editor --remote
```

在 Cloudflare Worker 的 production environment 設定 `GOOGLE_CLIENT_ID`，並將
`https://url-editor.ointw.com` 設為 Google OAuth Authorized JavaScript origin。
Google Client ID 是公開設定；Google client secret、Cloudflare API token 與本機
`.dev.vars` 不得提交至 repository。`npm run build:cloud` 產生 `dist/` 靜態資產，
`npx wrangler deploy` 會以 `src/worker.js` 部署 Worker，並使用 `ASSETS` 與 `DB` binding。
也可以直接執行 `npm run deploy:cloud` 完成建置與部署。

正式環境建置後可執行 `npm run security:check -- cloud`；GitHub Pages 建置後執行
`npm run security:check -- local`。Cloudflare preview deployment 預設不公開 OAuth 設定，只有正式
`url-editor.ointw.com` 會啟用雲端模式；本機 Worker 若要測試雲端流程，使用
獨立的 `.dev.vars` Client ID 並以 `npx wrangler dev` 啟動。

登入後 URL、標籤、排序／檢視設定與自訂預設會在瀏覽器端加密後才上傳。Recovery
Key 不會送到伺服器；遺失 Recovery Key 且沒有已解鎖裝置時，伺服器無法復原密文。
URL 仍可能含有使用者自行輸入的敏感 Query，這些內容在使用者開啟或測試目標網站
時也可能被該目標網站取得。

---

## 🤝 貢獻

歡迎任何形式的貢獻！如果您有任何想法或發現錯誤，請隨時提出 Issue 或發送 Pull Request。

---

## 📄 授權

此專案採用 MIT 授權。詳情請見 [LICENSE](LICENSE) 檔案。
