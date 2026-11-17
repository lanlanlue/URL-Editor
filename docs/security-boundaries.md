# 限流與資料維護邊界

## 限流

`src/server/api.js` 的 Map 是單一 Worker isolate 的記憶體 backstop：重啟、不同 isolate 或不同區域都不共享；不能用來承諾全域配額。最多保留 5,000 buckets，各自按建立時的 window 到期；容量用盡會拒絕新 key，不驅逐仍有效的限額。

支援注入三個可選 binding（本次沒有建立外部資源，也沒有配置 namespace ID）：

| binding | key | 本機 backstop |
|---|---|---|
| `AUTH_RATE_LIMITER` | `auth:<CF-Connecting-IP 或 unknown>` | 10 / 15 分鐘 |
| `SYNC_RATE_LIMITER` | `sync:<account id>` | 120 / 小時 |
| `PROBE_RATE_LIMITER` | `probe:<account id>` | 120 / 分鐘 |

binding 介面為 `await binding.limit({ key })`，必須回傳 `{ success: boolean }`。可由平台 limiter 或符合此契約的 adapter 注入。平台的配額／period 由正式環境設定，程式不會假裝平台已採用本機設定；尤其 15 分鐘／小時配額需要相容的 adapter／持久化服務，不能盲套平台所允許的 period。

- binding 未提供：只有 isolate-local backstop，沒有全域保證。
- binding 回傳 `success: false`：429。
- 已提供的 binding 壞掉、拋錯或回傳無效值：503 `RATE_LIMIT_UNAVAILABLE`，不降級放行。
- binding 允許後仍會套用 Map backstop。
- 原始 `X-Forwarded-For` 不再作為識別來源；缺少 CF 標頭的請求共用 `unknown` bucket。CF 標頭僅可在 Cloudflare 受控入口可信；自行架設代理時必須剝除訪客偽造標頭或注入可靠識別，不能直接公開這份 handler 並宣稱防偽。
- 即使接了平台 limiter，其保證範圍仍依平台定義；此介面本身不等於跨區域一致配額。

## 過期 session 清理

有 DB 的 API 請求以 best-effort 方式觸發清理（跨站拒絕與 OPTIONS 不觸發）。每個 DB 物件／isolate 最多每分鐘一次，一次最多 100 筆，僅刪 `expires_at <= now`，沿用既有 expiry index。不改 migration，不刪有效 session／使用者／同步資料；清理失敗不阻止正常回應，並受同一節流限制。它不是定時工作：無流量時不清理，多 isolate 也可能各自執行。

## 待正式環境／人工驗證

- GitHub Actions 的 reusable workflow 權限、main push 與手動觸發 deploy 閘門；PR 不部署。
- 部署 Node 20 的實際執行（本次本機 runtime 另列於驗證報告）。
- 選擇正式平台 limiter／adapter，設定真實 binding 與配額，檢查其跨 isolate／地區保證及故障回應。未配置前不能宣稱全域限流已部署。
- D1 真實執行計畫、expiry index 使用與流量下清理成本；不以本機 fixture 代替正式站證據。
- 瀏覽器輪替後重新整理頁面，以舊 Key 還原舊歷史，再確認新的上傳仍使用新 Key；取消／錯 Key 無資料變更。
- opaque-origin iframe 對目標網站的相容性；需要登入／儲存功能時用新分頁，而非放寬 sandbox。
- 本機與雲端匿名頁的 Network 面板沒有廣告第三方腳本請求；Worker CSP 不應新增廣告域名。
