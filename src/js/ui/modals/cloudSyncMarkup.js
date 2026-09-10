const CLOUD_SYNC_MARKUP = `
<dialog id="cloud-sync-modal" class="maintenance-modal cloud-sync-modal">
  <div class="modal-header">
    <h3 data-i18n="cloudSync.title">☁️ 加密雲端同步</h3>
    <button id="cloud-sync-close-btn" class="modal-close-btn" aria-label="關閉">✕</button>
  </div>
  <div class="modal-body">
    <p class="panel-desc" data-i18n="cloudSync.desc">
      登入後 URL 會先在瀏覽器加密，Cloudflare 只保存密文。Recovery Key 遺失時無法由伺服器還原。
    </p>
    <section id="cloud-sync-login-section" class="cloud-sync-section hidden">
      <p data-i18n="cloudSync.loginRequired">登入 Google 以啟用跨裝置同步。</p>
      <button id="cloud-sync-login-btn" class="btn-primary" data-i18n="cloudSync.loginBtn">使用 Google 登入</button>
    </section>
    <section id="cloud-sync-account-section" class="cloud-sync-section hidden">
      <p><span data-i18n="cloudSync.accountLabel">目前帳戶：</span><strong id="cloud-sync-account-name"></strong></p>
    </section>
    <section id="cloud-sync-recovery-section" class="cloud-sync-section hidden">
      <p class="panel-desc" data-i18n="cloudSync.recoveryDesc">第一次使用請產生 Recovery Key 並離線備份；新裝置只需輸入一次即可解鎖。</p>
      <div class="form-group">
        <button id="cloud-sync-generate-btn" class="btn-ghost" data-i18n="cloudSync.generateKeyBtn">產生 Recovery Key</button>
        <code id="cloud-sync-recovery-display" class="cloud-sync-recovery-display"></code>
        <div class="cloud-sync-recovery-actions">
          <button id="cloud-sync-copy-key-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.copyKeyBtn">複製 Key</button>
          <button id="cloud-sync-download-key-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.downloadKeyBtn">下載 Key</button>
        </div>
      </div>
      <div class="form-group">
        <label for="cloud-sync-recovery-input" data-i18n="cloudSync.recoveryInputLabel">貼上 Recovery Key 確認／解鎖</label>
        <input id="cloud-sync-recovery-input" class="tool-input" autocomplete="off" spellcheck="false" />
      </div>
      <button id="cloud-sync-unlock-btn" class="btn-primary" data-i18n="cloudSync.unlockBtn">確認並解鎖</button>
    </section>
    <section id="cloud-sync-unlocked-section" class="cloud-sync-section hidden">
      <p class="panel-desc" data-i18n="cloudSync.unlockedDesc">資料已解鎖；編輯停止 2 秒後會自動同步，也可以手動操作。</p>
      <div id="cloud-sync-first-upload-warning" class="cloud-sync-warning hidden" data-i18n="cloudSync.firstUploadWarning">這是第一次上傳，請確認你已備份 Recovery Key。</div>
      <div class="cloud-sync-actions">
        <button id="cloud-sync-upload-btn" class="btn-primary" data-i18n="cloudSync.uploadBtn">立即同步</button>
        <button id="cloud-sync-download-btn" class="btn-ghost" data-i18n="cloudSync.downloadBtn">下載並合併</button>
        <button id="cloud-sync-rotate-btn" class="btn-ghost" data-i18n="cloudSync.rotateBtn">旋轉 Recovery Key</button>
      </div>
      <div class="cloud-sync-history">
        <div class="cloud-sync-history__header">
          <strong data-i18n="cloudSync.historyTitle">歷史版本</strong>
          <button id="cloud-sync-history-refresh-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.historyRefreshBtn">重新整理</button>
        </div>
        <div class="cloud-sync-history__actions">
          <select id="cloud-sync-history-select" class="modal-select" aria-label="Cloud sync history"></select>
          <button id="cloud-sync-history-restore-btn" class="btn-ghost btn-sm" data-i18n="cloudSync.historyRestoreBtn">復原並合併</button>
        </div>
      </div>
    </section>
    <p id="cloud-sync-status" class="tool-status" role="status" aria-live="polite"></p>
  </div>
  <div class="modal-footer">
    <button id="cloud-sync-logout-btn" class="btn-ghost" data-i18n="cloudSync.logoutBtn">登出</button>
    <button id="cloud-sync-delete-account-btn" class="btn-delete" data-i18n="cloudSync.deleteAccountBtn">刪除帳戶</button>
  </div>
</dialog>`;

export default CLOUD_SYNC_MARKUP;
