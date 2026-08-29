# 更新履歷 (Changelog)

所有 URL-Editor 的顯著變更與版本發佈履歷均記錄於此。

---

## [2.1.2] - 2026-08-29

### 🐛 熱修復 (Hotfix)

#### 🌐 多國語系同步修正
- **修復 `en` 翻譯檔結構錯誤**：`urlList.batch` 出現重複鍵值定義，導致 `promptAddTag` 與 `confirmDelete` 在執行期被覆蓋而遺失；已合併為單一完整物件。
- **補齊 `en` 語系遺漏鍵值**：新增 `urlList.tagManager.title / rename / delete` 及 `urlList.importSuccess` 以與 `zh-TW` 完全對齊。
- **補齊 `zh-TW` 語系遺漏鍵值**：新增 `urlList.card.checkHealth` 對應「連線檢查」按鈕，避免語系切換時顯示鍵名原始字串。
- **驗證**：兩語系檔案現均包含 203 個鍵值，差異為零。

---

## [2.1.1] - 2026-08-29

### 🐛 缺陷修復 (Bug Fixes & UX Polish)

#### 🔘 操作按鈕可見度與交互優化
- **操作按鈕常駐顯示**：將表格操作按鈕（載入 ↩、開啟 ↗、檢查 📡、QR Code ⊡、刪除 ✕）改為預設常駐可見，避免初次使用無法察覺功能的痛點。
- **按鈕尺寸與觸控區擴大**：尺寸增至 `28px × 28px`，並加入主題色懸停微動畫與精準 Tooltip 提示。

#### ⭐ 表格釘選功能與排版修復
- **專屬釘選欄位**：新增 `col-pin` 獨立欄位，移除導致斷行跑版的偽元素。
- **即時釘選切換**：表格模式下可直接點擊 `⭐ / ☆` 切換釘選置頂狀態並持久化存檔。

#### 📐 表格左側邊距與選取指示條優化
- **舒適留白**：修復 Checkbox 貼合左側邊線問題，表頭與表身左側增設 `1rem` 留白與 `44px` 欄寬，選取指示邊條不再遮擋 Checkbox。

---

## [2.1.0] - 2026-08-29

### 🚀 新增功能 (Features)

#### 📊 表格檢視模式 (Table View Mode)
- **多維檢視切換**：新增 `表格檢視 (Table View)` 模式，與 `卡片檢視 (Cards)`、`Domain 分組檢視 (Grouped)` 並列三大清單呈現模式。
- **行內即時編輯**：支援在表格欄位中直接變更網址名稱 (Label) 與標籤 (Tags)。
- **一鍵快速動作**：整合一鍵複製網址、還原載入至編輯器、新分頁開啟、獨立健康檢查、產生 QR Code 與刪除。
- **即時狀態與統計指示**：表格整合即時健康狀態燈號 (🟢 線上 / 🔴 離線 / 🟡 檢查中) 與使用次數熱度指標 (🔥)。

#### ⚡ 即時端點測試沙盒 (Live Test & Sandbox Modal)
- **HTTP 請求沙盒**：支援直接在應用中發送測試請求至指定 URL（支援 `GET`、`POST`、`HEAD` 方法）。
- **請求客製化**：支援自訂 Request Headers 與 Request Body（支援 JSON 快速格式化）。
- **即時回應檢驗**：即時呈現 HTTP 狀態碼 (Status Code)、連線耗時 (Timing / Latency)、回應標頭 (Response Headers) 與語法高亮回應主體 (Response Body)。
- **CORS 狀態診斷**：提供 CORS 與網路連線失敗提示，加速 API 除錯與端點驗證。

#### 🎨 Favicon 增強與快取備援服務 (`faviconService`)
- **多層級 Favicon 備援**：支援 Google Favicon Service、DuckDuckGo 與本地 SVG 預設圖標階層式回退機制。
- **離線感知 (Offline Awareness)**：離線狀態下自動降級為本地內建圖標，防止無效網路請求。

### 💎 優化與改進 (Improvements & Polish)
- **🎨 深色模式與全域視覺精修**：全面優化對比度、Glassmorphism 效果、Modal 玻璃擬態與按鈕微互動。
- **🧪 測試覆蓋率擴充**：新增 9 個測試套件 (65 項測試全部通過)，包含 Live Test Modal、URL Card Table View 與 Jest 全域設定。
- **🤖 自動化發布流程**：新增 GitHub Actions Release 工作流，自動於 Tag 推送時建置發布包並建立 GitHub Release。

---

## [2.0.0] - 2026-08-22

### 🎉 重大功能發佈 (Major Release)

#### 🌐 URL 編輯器升級
- **快捷切換晶片 (Switcher Chips)**：
  - 協定一鍵切換 (`http ↔ https`)。
  - 通訊埠快捷切換 (`:3000`, `:8080`, `:5000`)。
  - 環境動態切換 (`dev`, `qa`, `staging`, `prod`)。
- **常用參數預設包 (Query Parameter Presets)**：
  - 支援 `QA 環境`、`Debug 模式` 等預設參數包快捷晶片。
  - 提供獨立管理彈窗，支援自訂預設包的新增、編輯、刪除與持久化儲存。
- **最近重組歷史紀錄 (Rebuild History)**：
  - 自動備份最近 10 筆重組紀錄，下拉選單 1 鍵還原。

#### 📋 清單與視圖管理
- **多維排序與星號釘選**：
  - 支援使用頻率 (🔥)、最近使用 (🕒)、建立時間 (🆕)、名稱 A-Z (🔤) 排序。
  - 常用 URL 釘選置頂 (⭐) 與亮色邊框視覺強化。
- **Domain 分組 Accordion 視圖**：
  - 提供 `📋 卡片清單` 與 `📁 Domain 分組` 雙視圖模式。
  - 依網域 (Host) 自動歸類與折疊面板，提供全展開與全收合。
- **📱 行動裝置測試 QR Code 產生器**：
  - 純 JS 原生繪製 HTML5 Canvas QR Code，手機相機直接掃描測試。
- **📡 手動網址連線檢查 (User-Triggered Health Check)**：
  - 依使用者指令觸發非同步超時探測，顯示 🟢 線上 / 🔴 無法連線 狀態徽章。
- **🏷️ 標籤集中管理器 (Tag Manager Modal)**：
  - 全域顯示標籤使用統計，支援一鍵全域重命名與批次刪除標籤。
- ** Favicon 視覺圖示**：卡片標題前自動顯示網站 Favicon，提昇辨識度。

#### 🛠️ 批次維護與資料匯入/匯出
- **🛠️ 批次維護工具 Modal**：
  - 批次替換 Domain（自動抓取現存網域並預覽 Diff）。
  - 關鍵字搜尋與取代（支援 URL/名稱欄位與區分大小寫）。
  - 一鍵重複網址清理（自動過濾重複項目並保留最新）。
- **📥 智慧批次貼上匯入 Modal**：
  - 支援一次貼上多列 URL、Markdown 連結 `[名稱](網址)` 或 CSV 內容。
  - 自動分析建議名稱與分類環境標籤，提供表格編輯與勾選預覽。
- **📄 CSV 格式支援**：
  - 完整支援 RFC 4180 標準 CSV 格式匯入與匯出（相容 Excel / Google Sheets）。

#### 🏗️ 專案結構與 UI 重構
- **CSS 模組化**：將過長樣式表拆分為 `variables.css`, `base.css`, `editor.css`, `cards.css`, `modals.css`, `responsive.css`。
- **全套單元與整合測試**：8 個測試套件 (55 項測試) 全數通過。
