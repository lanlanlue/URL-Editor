const CLOUD_SYNC_MARKUP = `
<dialog id="cloud-sync-modal" class="maintenance-modal cloud-sync-modal">
  <div class="modal-header">
    <h3 data-i18n="cloudSync.title">☁️ 加密雲端同步</h3>
    <button id="cloud-sync-close-btn" class="modal-close-btn" aria-label="關閉">✕</button>
  </div>
  <div class="modal-body">
    <p class="panel-desc" data-i18n="cloudSync.desc">
      登入後資料會先在瀏覽器端完成端到端加密，Cloudflare 只保存密文與包裝金鑰；伺服器無法讀取或重設你的密碼。
    </p>
    <section id="cloud-sync-login-section" class="cloud-sync-section hidden">
      <p data-i18n="cloudSync.loginRequired">登入 Google 以啟用跨裝置同步。</p>
      <button id="cloud-sync-login-btn" class="btn-primary" data-i18n="cloudSync.loginBtn">使用 Google 登入</button>
    </section>
    <section id="cloud-sync-account-section" class="cloud-sync-section hidden">
      <p><span data-i18n="cloudSync.accountLabel">目前帳戶：</span><strong id="cloud-sync-account-name"></strong></p>
    </section>
    <section id="cloud-sync-recovery-section" class="cloud-sync-section hidden">
      <div id="cloud-sync-setup-panel">
        <p class="panel-desc" data-i18n="cloudSync.setupDesc">設定一組同步密碼（至少 8 個字元），系統會同時產生一組備用 Recovery Key 當遺失密碼時的最後防線。請勿與 Google 密碼相同。</p>
        <form id="cloud-sync-setup-form" autocomplete="on">
          <input id="cloud-sync-setup-username" type="text" class="hidden" autocomplete="username" tabindex="-1" aria-hidden="true" />
          <div class="form-group cloud-sync-recovery-group">
            <label for="cloud-sync-new-password" data-i18n="cloudSync.newPasswordLabel">自訂同步密碼（至少 8 字元）</label>
            <div class="cloud-sync-password-row">
              <input
                id="cloud-sync-new-password"
                type="password"
                minlength="8"
                class="tool-input"
                placeholder="至少 8 個字元（可使用密碼管理員儲存）"
                data-i18n="[placeholder]cloudSync.newPasswordPlaceholder"
                autocomplete="new-password"
              />
              <button type="button" id="cloud-sync-toggle-new-pwd-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.showPassword">顯示</button>
            </div>
            <span id="cloud-sync-password-strength" class="cloud-sync-strength" role="status" aria-live="polite"></span>
          </div>
          <div class="form-group cloud-sync-recovery-group">
            <label for="cloud-sync-confirm-password" data-i18n="cloudSync.confirmPasswordLabel">再次輸入確認密碼</label>
            <input
              id="cloud-sync-confirm-password"
              type="password"
              minlength="8"
              class="tool-input"
              placeholder="再輸入一次相同密碼"
              data-i18n="[placeholder]cloudSync.confirmPasswordPlaceholder"
              autocomplete="new-password"
            />
          </div>
          <button type="submit" id="cloud-sync-create-vault-btn" class="btn-primary" data-i18n="cloudSync.createVaultBtn">建立同步密碼並產生備用 Key</button>
        </form>
        <div id="cloud-sync-backup-panel" class="cloud-sync-backup-panel hidden">
          <p class="panel-desc" data-i18n="cloudSync.backupHint">請先複製或下載下方的備用 Recovery Key。若日後忘記密碼，只有這組 Key 能救回資料：</p>
          <code id="cloud-sync-backup-display" class="cloud-sync-recovery-display"></code>
          <div class="cloud-sync-recovery-actions">
            <button type="button" id="cloud-sync-copy-backup-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.copyKeyBtn">複製 Key</button>
            <button type="button" id="cloud-sync-download-backup-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.downloadKeyBtn">下載 Key</button>
          </div>
          <label class="cloud-sync-backup-check">
            <input type="checkbox" id="cloud-sync-backup-confirmed" />
            <span data-i18n="cloudSync.backupConfirmLabel">我已妥善備份這組備用 Recovery Key</span>
          </label>
          <button type="button" id="cloud-sync-activate-btn" class="btn-primary" disabled data-i18n="cloudSync.activateSyncBtn">啟用加密同步</button>
        </div>
      </div>

      <div id="cloud-sync-password-unlock-panel" class="hidden">
        <p class="panel-desc" data-i18n="cloudSync.passwordUnlockDesc">輸入你的自訂同步密碼即可解鎖跨裝置資料。</p>
        <form id="cloud-sync-unlock-form" autocomplete="on">
          <input id="cloud-sync-unlock-username" type="text" class="hidden" autocomplete="username" tabindex="-1" aria-hidden="true" />
          <div class="form-group cloud-sync-recovery-group">
            <label for="cloud-sync-unlock-password" data-i18n="cloudSync.unlockPasswordLabel">同步密碼</label>
            <div class="cloud-sync-password-row">
              <input
                id="cloud-sync-unlock-password"
                type="password"
                class="tool-input"
                placeholder="輸入同步密碼"
                data-i18n="[placeholder]cloudSync.unlockPasswordPlaceholder"
                autocomplete="current-password"
              />
              <button type="button" id="cloud-sync-toggle-unlock-pwd-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.showPassword">顯示</button>
            </div>
          </div>
          <div class="cloud-sync-actions">
            <button type="submit" id="cloud-sync-password-unlock-btn" class="btn-primary" data-i18n="cloudSync.unlockBtn">解鎖同步</button>
            <button type="button" id="cloud-sync-use-recovery-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.forgotPasswordBtn">忘記密碼？改用 Recovery Key</button>
          </div>
        </form>
      </div>

      <div id="cloud-sync-legacy-panel" class="hidden">
        <p id="cloud-sync-legacy-desc" class="panel-desc" data-i18n="cloudSync.recoveryDesc">貼上備份的 Recovery Key 即可解鎖並還原資料。</p>
        <div id="cloud-sync-legacy-gen-wrap" class="form-group hidden">
          <button type="button" id="cloud-sync-generate-btn" class="btn-ghost" data-i18n="cloudSync.generateKeyBtn">產生 Recovery Key</button>
          <code id="cloud-sync-recovery-display" class="cloud-sync-recovery-display"></code>
          <div class="cloud-sync-recovery-actions">
            <button type="button" id="cloud-sync-copy-key-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.copyKeyBtn">複製 Key</button>
            <button type="button" id="cloud-sync-download-key-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.downloadKeyBtn">下載 Key</button>
          </div>
        </div>
        <div class="form-group cloud-sync-recovery-group">
          <label for="cloud-sync-recovery-input" data-i18n="cloudSync.recoveryInputLabel">貼上 Recovery Key 解鎖</label>
          <input
            id="cloud-sync-recovery-input"
            class="tool-input cloud-sync-recovery-input"
            placeholder="貼上 Recovery Key (例如 URE1-...)"
            data-i18n="[placeholder]cloudSync.recoveryPlaceholder"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="cloud-sync-actions">
          <button type="button" id="cloud-sync-unlock-btn" class="btn-primary" data-i18n="cloudSync.unlockWithRecoveryBtn">使用 Recovery Key 解鎖</button>
          <button type="button" id="cloud-sync-back-to-password-btn" class="btn-ghost btn-sm hidden" data-i18n="cloudSync.backToPasswordBtn">改回密碼解鎖</button>
        </div>
      </div>
    </section>

    <section id="cloud-sync-unlocked-section" class="cloud-sync-section hidden">
      <p class="panel-desc" data-i18n="cloudSync.unlockedDesc">資料已解鎖；編輯停止 2 秒後會自動同步，也可以手動操作。</p>
      <div id="cloud-sync-first-upload-warning" class="cloud-sync-warning hidden" data-i18n="cloudSync.firstUploadWarning">這是第一次上傳，請確認你已備份備用 Recovery Key。</div>
      <div id="cloud-sync-upgrade-banner" class="cloud-sync-upgrade-banner hidden">
        <span data-i18n="cloudSync.upgradeNotice">目前使用舊版單一 Recovery Key，可升級為「自訂密碼 + 備用 Key」雙軌模式。</span>
        <button type="button" id="cloud-sync-open-upgrade-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.upgradeBtn">立即升級</button>
      </div>
      <div class="cloud-sync-actions">
        <button type="button" id="cloud-sync-upload-btn" class="btn-primary" data-i18n="cloudSync.uploadBtn">立即同步</button>
        <button type="button" id="cloud-sync-download-btn" class="btn-ghost" data-i18n="cloudSync.downloadBtn">下載並合併</button>
        <button type="button" id="cloud-sync-open-password-btn" class="btn-ghost" data-i18n="cloudSync.changePasswordBtn">變更同步密碼</button>
        <button type="button" id="cloud-sync-rotate-btn" class="btn-ghost" data-i18n="cloudSync.rotateBtn">重設備用 Key</button>
      </div>

      <form id="cloud-sync-password-manage-panel" class="cloud-sync-manage-panel hidden" autocomplete="on">
        <input id="cloud-sync-manage-username" type="text" class="hidden" autocomplete="username" tabindex="-1" aria-hidden="true" />
        <h4 id="cloud-sync-manage-title" data-i18n="cloudSync.changePasswordTitle">變更同步密碼</h4>
        <div id="cloud-sync-current-secret-wrap" class="form-group cloud-sync-recovery-group">
          <label for="cloud-sync-current-secret-input" data-i18n="cloudSync.currentSecretLabel">目前同步密碼或備用 Recovery Key</label>
          <input
            id="cloud-sync-current-secret-input"
            type="password"
            class="tool-input"
            placeholder="輸入目前密碼或 URE1-... Recovery Key"
            data-i18n="[placeholder]cloudSync.currentSecretPlaceholder"
            autocomplete="current-password"
          />
        </div>
        <div class="form-group cloud-sync-recovery-group">
          <label for="cloud-sync-change-new-password" data-i18n="cloudSync.newPasswordLabel">新同步密碼（至少 8 字元）</label>
          <input
            id="cloud-sync-change-new-password"
            type="password"
            minlength="8"
            class="tool-input"
            placeholder="至少 8 個字元"
            data-i18n="[placeholder]cloudSync.newPasswordPlaceholder"
            autocomplete="new-password"
          />
        </div>
        <div class="form-group cloud-sync-recovery-group">
          <label for="cloud-sync-change-confirm-password" data-i18n="cloudSync.confirmPasswordLabel">再次輸入確認密碼</label>
          <input
            id="cloud-sync-change-confirm-password"
            type="password"
            minlength="8"
            class="tool-input"
            placeholder="再輸入一次相同密碼"
            data-i18n="[placeholder]cloudSync.confirmPasswordPlaceholder"
            autocomplete="new-password"
          />
        </div>
        <div class="cloud-sync-actions">
          <button type="submit" id="cloud-sync-save-password-btn" class="btn-primary btn-sm" data-i18n="cloudSync.savePasswordBtn">儲存新密碼</button>
          <button type="button" id="cloud-sync-cancel-manage-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.cancelBtn">取消</button>
        </div>
      </form>

      <form id="cloud-sync-rotate-panel" class="cloud-sync-manage-panel hidden" autocomplete="on">
        <h4 data-i18n="cloudSync.rotateKeyTitle">重設備用 Recovery Key</h4>
        <p class="panel-desc" data-i18n="cloudSync.rotateKeyDesc">輸入目前同步密碼後，將產生一組全新的備用 Recovery Key（原 Recovery Key 立即失效，密碼維持不變）。</p>
        <div class="form-group cloud-sync-recovery-group">
          <label for="cloud-sync-rotate-password-input" data-i18n="cloudSync.unlockPasswordLabel">目前同步密碼</label>
          <input
            id="cloud-sync-rotate-password-input"
            type="password"
            class="tool-input"
            placeholder="輸入目前同步密碼"
            data-i18n="[placeholder]cloudSync.unlockPasswordPlaceholder"
            autocomplete="current-password"
          />
        </div>
        <div class="cloud-sync-actions">
          <button type="submit" id="cloud-sync-confirm-rotate-btn" class="btn-primary btn-sm" data-i18n="cloudSync.confirmRotateBtn">產生並替換備用 Key</button>
          <button type="button" id="cloud-sync-cancel-rotate-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.cancelBtn">取消</button>
        </div>
      </form>

      <div id="cloud-sync-rotated-key-box" class="cloud-sync-backup-panel hidden">
        <p class="panel-desc" data-i18n="cloudSync.rotatedBackupHint">新的備用 Recovery Key 已生效，請務必重新複製或下載保存：</p>
        <code id="cloud-sync-rotated-display" class="cloud-sync-recovery-display"></code>
        <div class="cloud-sync-recovery-actions">
          <button type="button" id="cloud-sync-copy-rotated-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.copyKeyBtn">複製 Key</button>
          <button type="button" id="cloud-sync-download-rotated-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.downloadKeyBtn">下載 Key</button>
        </div>
      </div>

      <div class="cloud-sync-history">
        <div class="cloud-sync-history__header">
          <strong data-i18n="cloudSync.historyTitle">歷史版本</strong>
          <button type="button" id="cloud-sync-history-refresh-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.historyRefreshBtn">重新整理</button>
        </div>
        <div class="cloud-sync-history__actions">
          <select id="cloud-sync-history-select" class="modal-select" aria-label="Cloud sync history"></select>
          <button type="button" id="cloud-sync-history-restore-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.historyRestoreBtn">復原並合併</button>
        </div>
      </div>
    </section>
    <p id="cloud-sync-status" class="tool-status" role="status" aria-live="polite"></p>
  </div>
  <div class="modal-footer">
    <button type="button" id="cloud-sync-logout-btn" class="btn-ghost" data-i18n="cloudSync.logoutBtn">登出</button>
    <button type="button" id="cloud-sync-delete-account-btn" class="btn-delete" data-i18n="cloudSync.deleteAccountBtn">刪除帳戶</button>
  </div>
</dialog>`;

export default CLOUD_SYNC_MARKUP;
