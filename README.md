# URL-Editor

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/lanlanlue/URL-Editor/main.yml?branch=main)](https://github.com/lanlanlue/URL-Editor/actions)

一個輕量級、功能豐富的 URL 編輯與管理工具。它可以將 URL 解析成各個組成部分，讓使用者方便地修改、儲存、管理與分享，並即時預覽結果。

## 🚀 線上預覽 (Live Demo)

您可以直接在線上體驗這個工具：

**[點擊這裡前往線上版](https://lanlanlue.github.io/URL-Editor/)**

## ✨ 功能特色

- **URL 解析與編輯**：自動將 URL 解構成主機、路徑與查詢參數，並提供獨立欄位進行編輯。
- **查詢參數管理**：輕鬆地新增、編輯或刪除查詢字串中的鍵值對 (key-value pairs)。
- **URL 清單管理**：
    - **儲存與標籤**：將常用的 URL 儲存到清單中，並為其加上自訂標籤 (Tags) 以便分類。
    - **搜尋與篩選**：透過關鍵字搜尋，或點擊標籤來快速篩選您的 URL 清單。
- **即時預覽與複製**：當您進行修改時，最終組合而成的 URL 會即時更新，並提供一鍵複製功能。
- **匯入/匯出**：支援將您的 URL 清單匯出為 JSON 檔案備份，或從檔案匯入。
- **多國語言**：支援繁體中文與英文介面即時切換。
- **深色模式**：提供舒適的夜間使用體驗。

## 🔧 本地開發

如果您想為此專案做出貢獻，或在本地端運行，請依照以下步驟設定您的開發環境。

1.  **Fork** 此專案。
2.  **Clone** 您 fork 的儲存庫至本地：
    ```bash
    git clone https://github.com/your-username/URL-Editor.git
    ```
3.  進入專案目錄：
    ```bash
    cd URL-Editor
    ```
4.  安裝專案依賴：
    ```bash
    npm install
    ```
5.  啟動開發伺服器：
    ```bash
    npm start
    ```
    接著在瀏覽器中開啟 `http://localhost:1234` (或 Parcel 在終端機提示的網址)。

## 🤝 貢獻

歡迎任何形式的貢獻！如果您有任何想法或發現錯誤，請隨時提出 Issue 或發送 Pull Request。

## 📄 授權

此專案採用 MIT 授權。詳情請見 LICENSE 檔案。
