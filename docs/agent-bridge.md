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
| B | 本機中繼 + MCP server，LLM 以工具呼叫，不需瀏覽器自動化工具 | 規劃中 |

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

## 測試

- 單元：`src/js/core/agentBridge.test.js`
- 儲存競態回歸：`src/js/core/secureStorage.test.js`（`concurrent saves`）
