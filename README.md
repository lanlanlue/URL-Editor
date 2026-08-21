# URL-Editor

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/lanlanlue/URL-Editor/main.yml?branch=main)](https://github.com/lanlanlue/URL-Editor/actions)

一個輕量級、功能極其豐富的 URL 編輯、維護與管理工具。它可以將 URL 解析成各個組成部分，提供高頻編輯晶片、參數預設包、批次貼上匯入、批次網域維護、Domain 分組、連通性檢查與 QR Code 生成，幫助工程師與測試團隊極致提升工作效率。

---

## 🚀 線上預覽 (Live Demo)

您可以直接在線上體驗這個工具：

**[點擊這裡前往線上版](https://lanlanlue.github.io/URL-Editor/)**

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

### 📋 2. 智慧 URL 清單與視圖
- **多維排序與星號釘選**：
  - **排序方式**：使用頻率 (🔥)、最近使用 (🕒)、建立時間 (🆕)、名稱 A-Z (🔤)。
  - **⭐ 常用釘選**：將重要 URL 釘選置頂並強調視覺外框。
- **雙視圖模式**：
  - **📋 卡片清單**：直觀網格卡片檢視。
  - **📁 Domain 分組 Accordion**：按網域 (Host) 自動歸類與折疊面板，支援全展開與全收合。
- **📱 行動裝置測試 QR Code**：純 JS HTML5 Canvas 繪製，無第三方依賴，手機相機直接掃描測試。
- **📡 手動網址連線檢查 (User-Triggered Health Check)**：使用者點擊觸發非同步超時探測，即時標示 🟢 線上 / 🔴 無法連線 燈號。
- **🏷️ 標籤集中管理器 (Tag Manager Modal)**：全域檢視標籤使用筆數，支援一鍵全域「重命名」或「刪除標籤」。

### 🛠️ 3. 大量維護與匯入/匯出工具
- **🛠️ 批次維護工具 Modal**：
  - 批次替換 Domain（自動比對舊 Domain 並更換）。
  - 關鍵字搜尋與取代（支援 URL/標籤全域替換與 Match Case）。
  - 重複項目清理（自動偵測重複網址並一鍵保留最新）。
- **📥 智慧批次貼上匯入 Modal**：
  - 支援一次貼上多列 URL、Markdown 連結 `[標籤](網址)` 或 CSV 內容。
  - 自動分析建議名稱與分類環境標籤，提供動態勾選與表格編輯預覽。
- **📄 格式匯入與匯出**：
  - 支援 **JSON** 備份匯入與匯出。
  - 支援 RFC 4180 標準 **CSV** 表格格式匯入與匯出（相容 Excel / Google Sheets）。

### 🌍 4. 多語系與介面
- **多國語言 (i18n)**：繁體中文 (`zh-TW`) 與英文 (`en`) 無縫切換。
- **深色模式 (Dark Mode)**：提供舒適夜間與暗色主題切換。

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

---

## 🤝 貢獻

歡迎任何形式的貢獻！如果您有任何想法或發現錯誤，請隨時提出 Issue 或發送 Pull Request。

---

## 📄 授權

此專案採用 MIT 授權。詳情請見 [LICENSE](LICENSE) 檔案。
