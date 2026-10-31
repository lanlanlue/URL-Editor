# Engineering Backlog & 工程優化清單

本清單整合專案之核心架構可靠性迴圈 (Engineering Loop B1 ~ B30) 與工程品質/效能/安全加固任務 (P0 ~ P3)。

---

## 一、工程優化待辦清單 (P0 ~ P3 任務)

本文件依據優先級 P0（阻斷性重大缺陷）至 P3（次要改進與維護性）整理專案工程循環中識別的問題與優化方案。

---

## 優先級定義標準
- **P0（緊急阻斷）**：執行期崩潰、嚴重語法錯誤、無法運行的核心流程。必須立即修復。
- **P1（高優先級）**：CI / 測試流程嚴重阻塞、開發體驗雪崩、非同步懸掛、重要安全檢查阻斷。
- **P2（中優先級）**：代碼風格不一致、架構安全加固、防禦性編程、輸入驗證與邊界防護。
- **P3（低優先級）**：套件更新、技術債清理、邊界情境測試覆蓋率補強、文檔完善。

---

## 清單項目

### [x] [P0-1] `utmModal.js` 遺漏 `i18next` 引入導致執行期 ReferenceError
- **狀態**：✅ 已完成（Loop 1 修復）
- **修復成果與驗證數據**：
  - 在 `src/js/ui/modals/utmModal.js` 加入 `import i18next from 'i18next';`。
  - 新增 `tests/utmModal.test.js` 模擬剪貼簿複製與 `i18next.t('urlList.card.copied')` 互動，驗證無拋出 ReferenceError。
  - 測試驗證：`npm test` 22/22 suites 通過，`tests/utmModal.test.js` 4 項測試全數 PASS。
- **發現證據**：
  - 檔案：`src/js/ui/modals/utmModal.js:34`
  - 程式碼使用：`buttonEl.textContent = i18next.t('urlList.card.copied') || '已複製';`
  - 檔案頂部僅導入 `buildUtmUrl`, `getUtmPreset`, `UTM_KEYS`, `UTM_PRESETS`，未導入 `i18next`。
- **影響範圍**：
  - 當用戶開啟 UTM 生成視窗並點擊「複製」按鈕時，瀏覽器拋出 `ReferenceError: i18next is not defined`，造成按鈕文字未切換、後續邏輯中斷。
- **預期改善**：
  - 正確載入多語系資源，在點擊複製時顯示當前語系的「已複製」反饋，維持執行期穩定。
- **最小可行方案 (MVP)**：
  - 在 `src/js/ui/modals/utmModal.js` 頂部加入 `import i18next from 'i18next';`。
- **驗收標準**：
  - ESLint `no-undef` 檢查通過。
  - 測試或手動點擊複製按鈕無未捕獲異常拋出，正常切換多語系提示文字。
- **預估成本**：極低（5 分鐘）。實際耗時：5 分鐘。

---

### [x] [P1-1] ESLint `ignorePatterns` 缺失導致 Lint 耗時過長 (3722 秒) 與產物誤報
- **狀態**：✅ 已完成（Loop 1 修復）
- **修復成果與驗證數據**：
  - 在 `.eslintrc.json` 中配置 `"ignorePatterns": ["dist/", "dist-extension/", "coverage/", ".parcel-cache/", "android/", "ios/"]`。
  - 執行時間由 **3722 秒降至約 3.5 秒**（提速超過 1000 倍）。
  - 驗證數據：`npm run lint` 輸出 0 error, 0 warning，成功排除建置混淆產物誤報。
- **發現證據**：
  - 檔案：`.eslintrc.json`
  - 現狀配置：`"ignorePatterns": ["dist/"]`。
  - 執行 `npm run lint`（`eslint . --ext .js`）時，ESLint 深入解析 `dist-extension/`, `coverage/`, `.parcel-cache/` 等包含大量混淆與打包碼的目錄，導致掃描耗時達 3722 秒（超過 1 小時）。
- **影響範圍**：
  - 本地 pre-commit 與 CI 檢查嚴重超時、開發者體驗極差，且會對編譯後的第三方產物發出大量無效的 Lint 警告/錯誤。
- **預期改善**：
  - 排除所有非源始碼產物目錄，將全專案 Lint 耗時壓縮在 10 秒內。
- **最小可行方案 (MVP)**：
  - 修改 `.eslintrc.json` 中的 `ignorePatterns`：
    ```json
    "ignorePatterns": [
      "dist/",
      "dist-extension/",
      "coverage/",
      ".parcel-cache/",
      "android/",
      "ios/"
    ]
    ```
- **驗收標準**：
  - 執行 `npm run lint` 在 15 秒內完成，且不包含任何 `dist-*` 或 `coverage` 檔案的誤報。
- **預估成本**：低（10 分鐘）。實際耗時：5 分鐘。

---

### [x] [P1-2] `security-check.mjs` 硬編碼阻擋 `.wrangler` 暫存目錄
- **狀態**：✅ 已完成（Loop 2 修復）
- **修復成果與驗證數據**：
  - 在 `scripts/security-check.mjs` 引入 `isTrackedOrStagedInGit` 函式，利用 `git ls-files` 與 `git status --porcelain` 檢測路徑是否被 Git 追蹤或暫存。
  - 將 `.wrangler` 的判定改為：若存在且被 Git 追蹤或暫存才報錯阻斷，若已被 `.gitignore` 排除則安全放行，兼顧本地開發與 CI 邊界。
  - 驗證數據：執行 `npm run security:check`，本地即使存在 `.wrangler` 目錄亦能順利通過檢查 (Exit Code 0)。
- **發現證據**：
  - 檔案：`scripts/security-check.mjs:78-79`
  - 程式碼：
    ```javascript
    if (existsSync(join(projectRoot, '.wrangler')))
      fail('local deployment state path exists: .wrangler');
    ```
- **影響範圍**：
  - 開發者若在本地端執行過 `npx wrangler dev` 或 `npx wrangler deploy`，本地就會留下 `.wrangler` 資料夾（已在 `.gitignore` 中），後續執行 `npm run security:check` 將永遠失敗，造成不必要的阻斷。
- **預期改善**：
  - 調整檢查邏輯：將 `.wrangler` 目錄設為應被忽略（已在 ignoredDirectories 中），或者檢查是否被 gitignore 排除，而非單純存在就判定失敗。
- **最小可行方案 (MVP)**：
  - 移除對 `.wrangler` 目錄存在的無條件報錯，或改為若存在則驗證該目錄已被 git 忽略，確保 `npm run security:check` 在本地與 CI 中皆可正常通過。
- **驗收標準**：
  - 當本地存在 `.wrangler/` 目錄時，執行 `npm run security:check` 不會誤報阻斷失敗。
- **預估成本**：低（15 分鐘）。實際耗時：10 分鐘。

---

### [x] [P1-3] Jest 測試非同步懸掛（Open Handles）與 `i18next` 重複初始化
- **狀態**：✅ 已完成（Loop 2 修復）
- **修復成果與驗證數據**：
  - 在 `src/js/core/i18n.js` 中增加多語系初始化狀態檢查守衛 (`i18next.isInitialized`) 與 Promise 快取，消除重複初始化警告與 debug 雜訊。
  - 在 `src/js/main.js` 中確保多語系初始化正確協同調用。
  - 從 `package.json` 中的 `"test"` 腳本安全移除 `--forceExit`。
  - 驗證數據：執行 `npm test`（無 `--forceExit`），22 個測試套件、109 個測試於 4.9 秒內全數 PASS 並自然退出，控制台無 `i18next is already initialized` 警告與 Open Handles 警告。
- **發現證據**：
  - `package.json` 中的測試腳本被強制附加 `--forceExit`（如 `"test": "jest --forceExit"`）。若移除 `--forceExit`，Jest 在所有測試通過後無法自行結束並提示偵測到 Open Handles。
  - 測試執行時經常伴隨 `i18next::init: i18next is already initialized. You should call init just once!` 警告。
- **影響範圍**：
  - 掩蓋未清除的計時器（`setTimeout`, `setInterval`）或未關閉的監聽器，造成 Jest 進程無法正常回收，可能引起測試間的記憶體洩漏與交叉污染。
- **預期改善**：
  - 消除 Open Handles，使 Jest 在不需要 `--forceExit` 的情況下自然退出；規範測試環境中的 `i18next` 初始化生命週期。
- **最小可行方案 (MVP)**：
  - 使用 `jest --detectOpenHandles` 定位未清理的 handle（如 `setTimeout`、Clipboard 模擬、DOM 監聽等），在測試 `afterEach` 或 `afterAll` 加入清除邏輯；在 `jest.setup.js` 或測試載入點控制 i18next 只初始化一次或透過 mock 隔絕。
- **驗收標準**：
  - 執行 `jest`（無 `--forceExit` 參數）可正常在所有測試完成後於 5 秒內自行終止。
- **預估成本**：中（30-45 分鐘）。實際耗時：20 分鐘。

---

### [x] [P2-1] Prettier 程式碼格式與風格違規修復
- **狀態**：✅ 已完成（Loop 1 修復）
- **修復成果與驗證數據**：
  - 格式化 `src/js/main.js`、`src/js/core/secureStorage.js` 與 `src/server/api.test.js`。
  - 驗證數據：執行 `npx prettier --check "src/js/main.js" "src/js/core/secureStorage.js" "src/server/api.test.js"`，輸出 `All matched files use Prettier code style!`，無違規項目。
- **發現證據**：
  - 執行 `npx prettier --check "src/js/main.js" "src/js/core/secureStorage.js" "src/server/api.test.js"` 顯示格式問題警告。
- **影響範圍**：
  - 違反團隊代碼規範一致性，且在未來引入 pre-commit hook 或嚴格 CI 檢查時會報錯。
- **預期改善**：
  - 格式化違規檔案，符合 `.prettierrc` 與專案風格標準。
- **最小可行方案 (MVP)**：
  - 針對上述三檔案執行 Prettier 格式化修復並檢視 diff 確保無邏輯變更。
- **驗收標準**：
  - 執行 `npx prettier --check "src/js/main.js" "src/js/core/secureStorage.js" "src/server/api.test.js"` 輸出無任何 warning/error。
- **預估成本**：極低（5 分鐘）。實際耗時：3 分鐘。

---

### [x] [P2-2] 模組架構、安全性審查與例外處理加固
- **狀態**：✅ 已完成（Loop 3 修復）
- **修復成果與驗證數據**：
  - **URL 協議防護與 XSS 預防**：在 `src/js/core/urlParser.js` 實作 `isSafeProtocol`、`validateSafeUrl` 與 `validateUrl`，預設白名單限制 `http`, `https`, `ftp`, `file`，嚴格阻斷 `javascript:`, `data:`, `vbscript:` 等危險偽協議；在 `src/js/main.js` 與 `src/js/login.js` 的歷程讀取及 URL 解析中全面攔截；在多語系檔（`src/locales/zh-TW/translation.json`, `src/locales/en/translation.json`）補齊 `validation.unsupportedProtocol` 翻譯字串。
  - **SecureStorage 存儲健全化**：在 `src/js/core/secureStorage.js` 與 `src/js/core/cryptoVault.js` 中健全儲存與金鑰處理的例外防護，針對缺少 Web Crypto、QuotaExceeded 或無痕隱私限制等極端情境提供可預期回退，並建立專屬單元測試 `src/js/core/secureStorage.test.js` 與補強 `cryptoVault.test.js`。
  - **Cloudflare Worker API 邊界防禦**：在 `src/server/api.js` 中強化 Origin/CORS 檢查、CSRF Token 驗證防護、Request Payload 長度與結構限制防護，並在 `src/server/api.test.js` 補充完整邊界測試案例。
  - **驗證數據**：`npm test` 23/23 suites (126 tests) 全數通過；`npm run security:check` PASS (Exit Code 0)。
- **發現證據**：
  - Token 與憑證處理：審查 `src/js/core/secureStorage.js`，確認在不同瀏覽器環境（如無 Web Crypto 或無 IndexedDB/localStorage 權限）時的 fallback 與異常捕捉機制。
  - URL 輸入防護：URL 編輯與 UTM 產生器對於 `javascript:`、`data:`、`vbscript:` 等惡意偽協議的防護防線需要全面核實，預防 DOM-based XSS。
  - 後端 API 防禦：Cloudflare Worker (`src/server/`) 端點對惡意 Payload、超長 Request Body、CSRF 與 CORS 設定的防禦性檢查。
- **影響範圍**：
  - 使用者在載入不明來源 URL 或受限隱私環境下可能引發 XSS 或存儲報錯崩潰；後端端點可能面臨惡意注入風險。
- **預期改善**：
  - 強化核心防禦層，確保非合規 URL 被安全攔截，敏感操作具備健全的 Try-Catch 與使用者友善提示。
- **最小可行方案 (MVP)**：
  - 強化 URL 協議安全驗證函式；確保 `secureStorage.js` 中的加解密錯誤能優雅降級或拋出可預期之自訂異常；檢視 Worker API 輸入結構校驗。
- **驗收標準**：
  - 惡意協議測試（`javascript:alert(1)` 等）無法被渲染為可點擊執行的有效連結；相關單元測試均通過。
- **預估成本**：中（45-60 分鐘）。實際耗時：45 分鐘。

---

### [x] [P3-1] 瀏覽器相容性資料庫 (`caniuse-lite`) 過期更新
- **狀態**：✅ 已完成（Loop 3 修復）
- **修復成果與驗證數據**：
  - 執行 `npx update-browserslist-db@latest`，成功更新 `caniuse-lite` 至版本 1.0.30001819，並自動同步 `package-lock.json`。
  - 驗證數據：執行 `npm run build`，Parcel 建置在 2.79 秒內乾淨完成，完全消除原本提示的 16 個月 caniuse-lite 過期警告。
- **發現證據**：
  - 建置或測試階段控制台輸出提示：`Browserslist: caniuse-lite is outdated. Please run: npx update-browserslist-db@latest`。
- **影響範圍**：
  - Parcel 與 Babel 在評估 Polyfill 和 CSS 前綴時使用的是過時的瀏覽器版本數據，可能導致多餘的 Polyfill 或缺乏最新的特性支援。
- **預期改善**：
  - 更新至最新的 caniuse-lite 數據庫，消除警告並最佳化建置產物體積。
- **最小可行方案 (MVP)**：
  - 執行 `npx update-browserslist-db@latest` 更新鎖定檔與套件依賴。
- **驗收標準**：
  - 執行建置與測試時不再輸出 `caniuse-lite is outdated` 警告。
- **預估成本**：極低（5 分鐘）。實際耗時：5 分鐘。

---

### [x] [P3-2] 測試覆蓋率與關鍵元件測試補強
- **狀態**：✅ 已完成（Loop 1 提前落地，Loop 3 持續擴充）
- **修復成果與驗證數據**：
  - 在 `tests/utmModal.test.js` 建立專屬單元測試，完整覆蓋 UTM 模態框點擊複製與多語系回饋互動。
  - 在 `src/js/core/secureStorage.test.js` 補充 Storage 與例外容錯測試。
  - 在 `src/js/core/urlParser.test.js` 與 `src/js/main.test.js` 補充安全協議防護測試。
  - 單元測試套件全量達 23 suites / 126 tests 全數 PASS。
- **發現證據**：
  - 原先 `utmModal.js` 相關的互動邏輯（包含參數組合、複製至剪貼簿、多語系提示回饋）缺乏專屬單元測試，導致先前 `i18next` 缺失未能在測試中及早發現。
- **影響範圍**：
  - UI 模態框等直接面向使用者的功能缺乏自動化保護網，未來若有重構或新增參數時容易再次引入回歸缺陷。
- **預期改善**：
  - 撰寫 `utmModal.test.js`，模擬 DOM 點擊、剪貼簿行為與多語系輸出，提升整體可靠度。
- **最小可行方案 (MVP)**：
  - 在 `tests/` 建立 `utmModal.test.js`，覆蓋開啟對話框、產出 UTM 網址、點擊複製與按鈕文字切換等情境。
- **驗收標準**：
  - `utmModal.test.js` 通過且覆蓋率提升，測試執行穩定無 Open Handles。
---

## 二、自主工程架構與可靠性 Backlog (B1 ~ B30 任務)

Base Commit: ab46b3f. All items are HYPOTHESES from read-only audits until a failing test reproduces them.

| ID | Pri | Problem | Owner | Status |
|---|---|---|---|---|
| B1 | P0 | Startup overwrites unreadable encrypted record with empty state; prune wipes history (main.js, secureStorage.js) | Worker B | INTEGRATED (fd33099) |
| B2 | P0 | restoreCloudData re-stamps remote entries as local edits; deletions resurrect (main.js) | Worker B | INTEGRATED (fd33099) |
| B3 | P0 | Session token rotation race logs user out (api.js) | Worker A | INTEGRATED (ef0705e) |
| B4 | P1 | cleanupHistory failure reported as 409 after committed write (api.js) | Worker A | INTEGRATED (ef0705e) |
| B5 | P1 | healthStatus persisted/synced as an edit; 'checking' can stick (main.js) | Worker B | INTEGRATED (fd33099) |
| B6 | P1 | Probe disabled globally 60s after one failure; skipped assertions shown as pass | Worker B | INTEGRATED (fd33099) |
| B7 | P1 | Keyword body read has no timeout (healthCheck.js) | Worker B | INTEGRATED (fd33099) |
| B8 | P1 | Title regex quadratic backtracking; IPv6 2002::/16 etc.; raw error.message as code | Worker A | INTEGRATED (ef0705e) |
| B9 | P1 | exp missing not rejected; JWKS fetch no timeout (api.js) | Worker A | INTEGRATED (ef0705e) |
| B10 | P1 | Malformed % aborts whole batch import (urlParser.js) | Worker B | INTEGRATED (fd33099) |
| B11 | P1 | isEmbeddable ignores comma-combined CSP (frameHeaders.js) | Worker A | INTEGRATED (ef0705e) |
| B12 | P2 | Auto-sync fetches fresh ETag before PUT, overwriting remote changes | Worker F | INTEGRATED (9317dec) |
| B13 | P2 | checkHistory O(n^2) I/O; liveTestModal races | round 2 | pending |
| B14 | P3 | Missing tests: api.js, secureStorage, cryptoVault, cloudApi; jest.config does not collect src/server | Worker D | INTEGRATED (b248f44) |

## Out of scope (needs human decision)
Cross-isolate rate limiting, expired-session purge and storage caps (Cloudflare infra), IP pinning, npm audit (dev tooling only; --omit=dev is 0), CSRF rotation semantics.

## New from Critic/Challenger (non-blocking)
- B15 (P2): rotation race loser keeps old token_hash, so issueCsrfToken/logout UPDATE matches 0 rows and the returned CSRF token is not stored (api.js ~321-326, ~665). Fix: re-select session when changes !== 1.
- B16 (P3): IPv6 block list misses 3fff::/20, 2001:2::/48, 2001:10::/28, 2001:20::/28 (non-routable, not an SSRF vector).
- B17 (P3): `typeof claims.exp === 'number'` strictness; log cleanupHistory failures; outer readJson catch inconsistency (probe/delete give 500).
- B18 (P3): jest.config.js has no testPathIgnorePatterns for `.claude/`, so `npx jest` in the main checkout also runs worktree copies. Dev-experience only.

## New from Worker B reviews
- B19 (P1, needs decision, requires cloudSyncModal.js): when the guest record is unreadable, cloudSyncModal.js:378-392,465 starts from the empty placeholder (callbacks.getData()), sets guestMigrationPending and may upload it. Guest record is now preserved (clearGuestState guard) so no data is destroyed, but the placeholder is still migrated/uploaded. Fix: use hasUnreadableGuestRecord() to start from remote-only data, skip migration/upload, and pass { confirmedRecovery: true } only from an explicit user action.
- B20 (P3): liveTestModal.js:122,163,615 read entry.healthStatus (now always undefined); runtimeHealthStatus Map not cleaned on entry delete.
- B21 (P3): unreadable detection is guest-record only (loadAccountState throws and never sets the flag); unreadable-backup:* has no pruning or restore UI; banner not re-translated on language switch and uses inline styles.
- B22 (P3): in-flight 401/404/429 can shorten an active 30s backoff to 10s (pre-existing).

## Round 2 updates
- B19: INTEGRATED (75df3d8) after Critic rework (flag now cleared only for saves carrying real urls/presets).
- B14: INTEGRATED (b248f44). Coverage lines/branches before -> after: api.js 70.4/62.0 -> 98.0/95.1; secureStorage.js 71.8/50.4 -> 96.6/92.9; cryptoVault.js 63.0/41.7 -> 98.6/96.7; cloudApi.js 0/0 -> 100/100; entryCheck.js 100/50 -> 100/100; redirectGenerator.js 74.0/35.2 -> 100/98.9; trackerStripper.js 76.5/56.3 -> 100/100; settings.js 95.7/52.4 -> 100/95.2. Spot mutation check (CSRF check off: 6 tests fail; expiry check off: 1 fails).
- B18: RESOLVED by jest.config.js testPathIgnorePatterns ['<rootDir>/.claude/'] and src/server in collectCoverageFrom.
- B23 (P0/P1, found by Worker D): api.js route dispatch lacks `await` for logout/sync GET/PUT/revisions/delete-account, so thrown 401/403 Responses and DB errors make handleApiRequest reject (Worker throws) instead of returning JSON. Pre-existing. Assigned to Worker E with B24 (`[::1]` hostname) and B15.
- B25 (P3): cryptoVault.js:13-16 TextDecoder fallback spreads an ArrayBuffer (breaks only where TextDecoder is missing, e.g. jsdom).

## Round 2 / Worker E (integrated 6524874)
- B23 INTEGRATED: awaited all route handlers (also authenticateGoogle); 18 tests failed before the fix.
- B24 INTEGRATED: bracketed IPv6 loopback accepted for OAuth config.
- B15 INTEGRATED after one rework: the first lookup keyed on csrf_hash (mutable) and could 401 the loser of the rotation race when the winner re-issued CSRF; final lookup uses immutable columns (user_id, created_at, last_authenticated_at, expires_at) plus last_rotated_at newer than the stale row. Verified by grep that no UPDATE changes those columns.
- Residual (B26, low): logout vs rotation delete race; sibling session of the same user created in the same second that also rotated could be adopted (needs a surrogate session id in the schema).
- Still open: B12 (awaiting user decision, see b12-design.md), B13 (checkHistory perf, liveTestModal races), B16, B17, B20, B21, B22, B25, B26. Out of scope: infra-level rate limiting/session purge/storage caps, npm audit (dev tooling only).

## Round 3 (final)
- B12 INTEGRATED (a29a0de..9317dec) after Critic/Challenger review and a test-strengthening pass.
- B27 (P3): 409-driven auto-sync retries have no attempt cap.
- See final-report.md for the consolidated status.

## Round 4 (integrated)
- Worker H (ff to d033857): B16, B17, B22, B25, B26, B20(map cleanup). Worker G (merge 957ded6): B13a/b, B20(liveTestModal), B27, after one rework (checkHistory two-tab loss).
- New low-priority items: B28 (history ordering by flush order), B29 (prune vs another tab's pending records), B30 (dialog close paths unverified in a real browser).
- Still open: B21, B28, B29, B30 and the infra items. See final-report.md.

## Round 5 (integrated c4dfbc6)
- B21 (part) INTEGRATED (3db5434, d13637d). B28 INTEGRATED after two reworks (final: untrusted `t` ranks oldest). B30 INTEGRATED. B29 REVERTED (clock-dependent, can drop valid records); limitation documented.
- Open (all P3): B21 remainder (backup prune/restore UI, account-scope detection), B29 orphan id, B28 residual clock cases, B30 real-browser check, and the infra items.

