# Agent Bridge（LLM 代理維護介面）

讓 LLM 能直接新增、查詢、修改、刪除 URL 清單，而不需要模擬點擊畫面。

## 為什麼是瀏覽器端橋接

雲端同步是端到端加密（E2EE）：伺服器與 D1 只存密文，金鑰只存在已登入、已解鎖的
瀏覽器分頁中。因此 LLM 無法（也不應）直接呼叫後端 API 改資料；橋接層讓 LLM 透過
**該分頁內**的函式操作，加密與同步仍由原本流程處理，零知識性質不變。

## 階段

| 階段 | 內容 | 狀態 |
|---|---|---|
| A | 頁面內 `window.urlEditorAgent`，由瀏覽器工具以單次 JS 呼叫 | 已完成 |
| B | 本機中繼 + MCP server，LLM 以工具呼叫，不需瀏覽器自動化工具 | 已完成 |

## 啟用（A）

預設**不啟用**，`window.urlEditorAgent` 不存在。符合任一條件才會安裝：

- 網址帶 `?agent=1`
- `localStorage.urlEditorAgent === '1'`（使用者自行設定）

啟用只決定「是否暴露介面」，不是對 LLM 的授權；能在分頁內執行 JS 的人本來就能讀寫
同源資料。

## API

所有方法同步回傳 `{ ok: true, ... }` 或 `{ ok: false, error: { code, message } }`。

| 方法 | 說明 |
|---|---|
| `describe()` | 版本、可編輯欄位、方法簽名 |
| `list({ query?, tag?, limit? })` | 回傳 `{ total, items }`；`query` 比對 URL／標籤／名稱 |
| `get(id)` | 回傳 `{ item }` |
| `add(input)` / `addMany(inputs, { skipDuplicates = true })` | 回傳 `{ added, skipped }`，`skipped` 帶 `index` 與 `reason`（`invalid_url`／`duplicate`） |
| `update(id, patch)` | 回傳 `{ item }` |
| `remove(id \| id[])` | 回傳 `{ removed }`，並寫入墓碑 |
| `undo()` | 還原上一次寫入，最多 20 步 |

可編輯欄位僅 `url`、`label`、`tags`、`isPinned`。`id`、`usageCount`、時間戳等一律忽略，
新增時的 `id` 由系統產生，不接受呼叫端指定。單次批次上限 200 筆。

錯誤碼：`invalid_input`、`invalid_url`、`not_found`、`too_many`、`nothing_to_undo`。

## 同步行為

寫入一律經 `saveState()`：先蓋時間戳與墓碑，再加密儲存，並發出
`url-editor-data-change`，雲端同步據此上傳（ETag／If-Match 與三方合併不變）。
`undo()` 還原的項目會重新蓋章，較新的實體會贏過先前刪除留下的墓碑；撤銷新增時會補墓碑，
讓其他裝置同步後也移除。

加密儲存的寫入已序列化（`secureStorage.saveSecureState`），連續呼叫不會互相干擾。

## 限制與安全注意

- 需要一個已登入並解鎖的分頁；分頁關閉或未解鎖時無法操作。
- 目前寫入直接生效，沒有人工核准步驟，`undo()` 是唯一的安全網。
- 儲存資料無法解密時（`isStorageUnreadable`），寫入會拒絕，避免覆蓋原紀錄。
- URL 可能含敏感 Query；經橋接層讀出的內容會進入 LLM 的對話脈絡。

## 使用範例

```js
const a = window.urlEditorAgent;
a.addMany([
  { url: 'https://staging.example.com/api', label: 'Staging API', tags: ['staging'] },
]);
a.list({ tag: 'staging' });
a.update(id, { label: 'Staging API v2' });
a.undo();
```

## 本機中繼 + MCP（B）

```
LLM client ──stdio MCP──▶ cli.cjs（MCP + 127.0.0.1 中繼）◀──HTTP long-poll── 已解鎖的分頁
                                                                       └─▶ window.urlEditorAgent
```

頁面**主動連出**到本機中繼，因此瀏覽器端不需開任何埠；加密與金鑰仍只在分頁內。
整條路徑不需要截圖、讀 DOM 或點擊，LLM 只看到下列工具。

### 設定

1. 註冊 MCP server（以 Claude Code 為例，路徑換成你的 repo）：

   ```bash
   claude mcp add url-editor -- node /path/to/URL-Editor/src/agent-relay/cli.cjs
   ```

2. MCP client 啟動後，中繼會在 **stderr** 印出一次性的配對網址：
   `https://url-editor.ointw.com/?agent=1#agent-relay=<port>:<token>`
3. 在**已登入、已解鎖**的分頁開啟該網址。頁面讀取 fragment 後立即從網址列移除，
   並把配對存在 `sessionStorage`（關閉分頁即失效）。
4. 呼叫 `bridge_status` 確認 `connected: true`。

登入頁若導向 `/login` 而丟失 fragment，請先登入並解鎖，再開配對網址。

### 工具

`bridge_status`、`list_urls`、`get_url`、`add_urls`、`update_url`、`remove_urls`、
`undo_last_change`，語意與上方 API 一一對應。失敗時 `isError: true`，內容為
`{ ok: false, error: { code, message } }`；中繼層額外的錯誤碼：
`no_client`（沒有配對分頁）、`timeout`（頁面逾時未回應）、`unknown_method`、`shutdown`。

### 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `URL_EDITOR_RELAY_PORT` | `17891` | 監聽埠（1024–65535，僅 127.0.0.1） |
| `URL_EDITOR_APP_ORIGIN` | `https://url-editor.ointw.com` | 配對網址與 CORS 允許的來源 |
| `URL_EDITOR_ALLOWED_ORIGINS` | 空 | 額外允許的來源，逗號分隔；`localhost:1234` 預設已允許 |
| `URL_EDITOR_RELAY_TOKEN` | 每次啟動隨機 | 固定 token 可免重新配對，但降低安全性 |

### 安全模型

- 僅綁定 `127.0.0.1`；每個請求都需 `Authorization: Bearer <token>`（常數時間比對）。
- 檢查 `Host`（擋 DNS rebinding）與 `Origin` 白名單；預檢回應含 `Access-Control-Allow-Private-Network`。
- 頁面只連 `http://127.0.0.1:<port>`，配對只提供埠與 token，不能指定其他主機。
- 方法白名單：中繼與頁面兩端各自檢查，只能呼叫橋接層的 8 個方法，沒有任何 eval 或任意函式存取。
- token 走 URL fragment，不會送到任何伺服器，且配對後立即清除。
- 請求本文上限 1 MB；單次批次上限 200 筆。
- 零新增依賴；MCP 為自行實作的最小 stdio 子集（`initialize`、`ping`、`tools/list`、`tools/call`）。

### 已知限制

- 分頁必須維持開啟且已解鎖；背景分頁亦可，但瀏覽器可能節流計時器，回應會變慢。
- 寫入仍是直接生效（尚無核准機制），安全網是 `undo_last_change`。
- 中繼結束後，頁面會以最長 10 秒的退避持續重試，主控台會出現 `ERR_CONNECTION_REFUSED`，屬預期行為。
- 一個中繼對應一個分頁；重新整理或開第二個分頁時，較新的連線會取代舊的。
- 正式站（HTTPS）連到 `http://127.0.0.1` 依賴瀏覽器對 loopback 的混合內容豁免；較新版 Chrome
  的 Local Network Access 可能跳出授權提示。這部分**尚未在正式站實測**，僅在 `localhost:1234` 驗證。

## 測試

- 橋接層：`src/js/core/agentBridge.test.js`
- 中繼／MCP／端到端：`src/agent-relay/*.test.js`、`src/js/core/agentRelayClient.test.js`
- 儲存競態回歸：`src/js/core/secureStorage.test.js`（`concurrent saves`）
