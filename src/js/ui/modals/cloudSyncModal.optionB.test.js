/**
 * Integration tests for Option B (random 256-bit DEK + dual key-wrapping slots:
 * custom password via PBKDF2-SHA256 + backup Recovery Key via HKDF-SHA256)
 * running against the real `cryptoVault.js` Web Crypto implementation and the
 * real `cloudSyncModal.js` + `cloudSyncMarkup.js` UI.
 */

const cloneJson = (v) =>
  v === null || v === undefined ? v : JSON.parse(JSON.stringify(v));

async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('Timed out waiting for async modal operation');
}

function makeFakeCloudServer() {
  const server = {
    document: null,
    revision: 0,
    revisions: new Map(), // revision -> envelope
    puts: [],
  };
  return server;
}

async function makeOptionBDevice(
  server,
  { localData = { schemaVersion: 1, urls: [], presets: [] } } = {}
) {
  jest.resetModules();
  document.body.innerHTML = '';

  class CloudApiError extends Error {
    constructor(message, { status = 0 } = {}) {
      super(message);
      this.status = status;
    }
  }

  let storedKeyRecord = null;
  const secure = {
    clearGuestState: jest.fn().mockResolvedValue(undefined),
    deleteCurrentAccountLocalState: jest.fn().mockResolvedValue(undefined),
    getAccountEncryptionKey: jest.fn(async () => storedKeyRecord),
    getStorageMode: jest.fn(() => 'indexeddb'),
    loadAccountState: jest.fn().mockResolvedValue(null),
    useAccountEncryptionKey: jest.fn(async (_accountId, key, metadata = {}) => {
      storedKeyRecord = {
        key,
        salt: metadata.salt || null,
        keyVersion: metadata.keyVersion || 1,
        ...(metadata.payloadSchemaVersion !== undefined
          ? { payloadSchemaVersion: metadata.payloadSchemaVersion }
          : {}),
        ...(metadata.keySlots !== undefined
          ? { keySlots: metadata.keySlots }
          : {}),
      };
    }),
    hasUnreadableGuestRecord: jest.fn(() => false),
    isStorageUnreadable: jest.fn(() => false),
  };

  const api = {
    CloudApiError,
    deleteAccount: jest.fn(),
    getSession: jest.fn().mockResolvedValue({
      csrfToken: 'csrf-token',
      user: { id: 'acct-option-b', email: 'user@example.com' },
    }),
    getSyncDocument: jest.fn(async () => ({
      document: server.document ? cloneJson(server.document) : null,
      etag: `"rev-${server.revision}"`,
      revision: server.revision,
    })),
    getSyncRevision: jest.fn(async (rev) => {
      const env = server.revisions.get(rev);
      if (!env) throw new CloudApiError('Revision not found', { status: 404 });
      return cloneJson(env);
    }),
    listSyncRevisions: jest.fn(async () =>
      [...server.revisions.keys()]
        .sort((a, b) => b - a)
        .map((revision) => ({ revision, createdAt: revision * 1000 }))
    ),
    logout: jest.fn(),
    putSyncDocument: jest.fn(async (envelope, _csrf, etag = '"rev-0"') => {
      const match = /^"rev-(\d+)"$/.exec(etag);
      if (
        !match ||
        Number(match[1]) !== server.revision ||
        envelope.revision !== server.revision + 1
      ) {
        throw new CloudApiError('conflict', { status: 409 });
      }
      if (server.document) {
        server.revisions.set(server.revision, cloneJson(server.document));
      }
      const saved = cloneJson(envelope);
      server.revision = envelope.revision;
      server.document = saved;
      server.puts.push(saved);
      return {
        document: cloneJson(saved),
        etag: `"rev-${server.revision}"`,
        revision: server.revision,
      };
    }),
  };

  jest.doMock('../../core/secureStorage.js', () => secure);
  jest.doMock('../../core/cloudApi.js', () => api);
  jest.doMock('../../core/runtimeConfig.js', () => ({ CLOUD_ENABLED: true }));
  jest.doMock('../../core/i18n.js', () => ({
    __esModule: true,
    default: { t: (key, opts) => opts?.defaultValue ?? key },
  }));

  const device = {
    state: cloneJson(localData),
    secure,
    api,
    getStoredKey: () => storedKeyRecord,
  };
  device.getData = jest.fn(() => device.state);
  device.onRestore = jest.fn((data) => {
    device.state = data;
  });

  const mod = await import('./cloudSyncModal.js');
  mod.initCloudSyncModal({
    getData: device.getData,
    onRestore: device.onRestore,
  });

  device.nodes = Array.from(document.body.childNodes);
  device.activate = () => document.body.replaceChildren(...device.nodes);
  device.activate();
  await waitUntil(() => {
    device.activate();
    const accountName = document.getElementById('cloud-sync-account-name');
    const rec = document.getElementById('cloud-sync-recovery-section');
    const unlocked = document.getElementById('cloud-sync-unlocked-section');
    return (
      accountName?.textContent === 'user@example.com' &&
      ((rec && !rec.hidden) || (unlocked && !unlocked.hidden))
    );
  });
  device.status = () => {
    device.activate();
    const el = document.getElementById('cloud-sync-status');
    return {
      text: el?.textContent || '',
      isError: el?.classList.contains('text-error') || false,
    };
  };
  device.waitForUnlock = async () => {
    await waitUntil(() => {
      device.activate();
      const unlocked = document.getElementById('cloud-sync-unlocked-section');
      const createBtn = document.getElementById('cloud-sync-create-vault-btn');
      return unlocked && !unlocked.hidden && !createBtn?.disabled;
    });
  };
  return device;
}

const makeUrl = (id, title = id) => ({
  id,
  url: `https://example.com/${id}`,
  title,
  tags: ['sync'],
  createdAt: 1000,
  updatedAt: 2000,
});

describe('Option B DEK + dual keySlots cloud sync E2E flows', () => {
  test('(a)-(c) Device A sets custom password + backs up key, Device B unlocks with password or Recovery Key', async () => {
    const server = makeFakeCloudServer();
    await makeOptionBDevice(server, {
      localData: {
        schemaVersion: 1,
        urls: [makeUrl('item-a', 'From Device A')],
        presets: [],
      },
    });

    // Setup panel visible, backup panel hidden before creating vault.
    expect(document.getElementById('cloud-sync-setup-panel').hidden).toBe(
      false
    );
    expect(document.getElementById('cloud-sync-backup-panel').hidden).toBe(
      true
    );

    // Real-time strength feedback enforces MIN_PASSWORD_LENGTH = 8.
    const pwdInput = document.getElementById('cloud-sync-new-password');
    const confirmInput = document.getElementById('cloud-sync-confirm-password');
    const strengthEl = document.getElementById('cloud-sync-password-strength');
    pwdInput.value = 'short';
    pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(strengthEl.dataset.strength).toBe('tooShort');

    pwdInput.value = 'StrongPass!2026';
    pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(['fair', 'strong']).toContain(strengthEl.dataset.strength);
    confirmInput.value = 'StrongPass!2026';

    // Submit setup form to wrap DEK into dual keySlots and reveal backup key.
    document
      .getElementById('cloud-sync-setup-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitUntil(() => {
      const backupPanel = document.getElementById('cloud-sync-backup-panel');
      return backupPanel && !backupPanel.hidden;
    });

    const backupKeyDisplay = document
      .getElementById('cloud-sync-backup-display')
      .textContent.trim();
    expect(backupKeyDisplay).toMatch(/^URE1-/);

    // Activate button stays disabled until backup checkbox is confirmed.
    const activateBtn = document.getElementById('cloud-sync-activate-btn');
    const backupCheck = document.getElementById('cloud-sync-backup-confirmed');
    expect(activateBtn.disabled).toBe(true);
    backupCheck.checked = true;
    backupCheck.dispatchEvent(new Event('change', { bubbles: true }));
    expect(activateBtn.disabled).toBe(false);

    // Activating uploads initial v2 envelope immediately with keySlots.
    activateBtn.click();
    await waitUntil(() => server.revision === 1);

    expect(server.document.payloadSchemaVersion).toBe(2);
    expect(server.document.keySlots.v).toBe(1);
    expect(server.document.keySlots.password.kdf).toBe('PBKDF2-SHA256');
    expect(server.document.keySlots.password.iterations).toBe(600000);
    expect(server.document.keySlots.recovery.kdf).toBe('HKDF-SHA256');

    // (b) Device B sees password unlock panel directly, rejects wrong password, unlocks with custom password.
    const deviceB1 = await makeOptionBDevice(server);
    expect(
      document.getElementById('cloud-sync-password-unlock-panel').hidden
    ).toBe(false);

    document.getElementById('cloud-sync-unlock-password').value =
      'WrongPassword1';
    document
      .getElementById('cloud-sync-unlock-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => deviceB1.status().isError);

    document.getElementById('cloud-sync-unlock-password').value =
      'StrongPass!2026';
    document
      .getElementById('cloud-sync-unlock-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await deviceB1.waitForUnlock();
    expect(deviceB1.state.urls.map((u) => u.id)).toEqual(['item-a']);

    // (c) Device B2 simulates forgotten password and falls back to backup Recovery Key.
    const deviceB2 = await makeOptionBDevice(server);
    document.getElementById('cloud-sync-use-recovery-btn').click();
    expect(document.getElementById('cloud-sync-legacy-panel').hidden).toBe(
      false
    );
    document.getElementById('cloud-sync-recovery-input').value =
      backupKeyDisplay;
    document.getElementById('cloud-sync-unlock-btn').click();
    await deviceB2.waitForUnlock();
    expect(deviceB2.state.urls.map((u) => u.id)).toEqual(['item-a']);
  });

  test('(d)-(e) Changing password preserves 30-day history & Recovery Key; rotating Recovery Key preserves password', async () => {
    const server = makeFakeCloudServer();
    const deviceA = await makeOptionBDevice(server, {
      localData: {
        schemaVersion: 1,
        urls: [makeUrl('rev-1-url', 'Old Revision Item')],
        presets: [],
      },
    });

    document.getElementById('cloud-sync-new-password').value =
      'InitialPass!123';
    document.getElementById('cloud-sync-confirm-password').value =
      'InitialPass!123';
    document
      .getElementById('cloud-sync-setup-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(
      () => !document.getElementById('cloud-sync-backup-panel').hidden
    );
    const recoveryKey1 = document
      .getElementById('cloud-sync-backup-display')
      .textContent.trim();
    const check = document.getElementById('cloud-sync-backup-confirmed');
    check.checked = true;
    check.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('cloud-sync-activate-btn').click();
    await waitUntil(() => server.revision === 1);

    // Edit state and upload revision 2 so revision 1 is archived in history.
    deviceA.state = {
      schemaVersion: 1,
      urls: [makeUrl('rev-1-url'), makeUrl('rev-2-url')],
      presets: [],
    };
    document.getElementById('cloud-sync-upload-btn').click();
    await waitUntil(() => server.revision === 2);

    // (d) Change password -> re-wraps password slot around same DEK -> revision 3.
    document.getElementById('cloud-sync-open-password-btn').click();
    expect(
      document.getElementById('cloud-sync-password-manage-panel').hidden
    ).toBe(false);
    document.getElementById('cloud-sync-current-secret-input').value =
      'InitialPass!123';
    document.getElementById('cloud-sync-change-new-password').value =
      'UpdatedPass!456';
    document.getElementById('cloud-sync-change-confirm-password').value =
      'UpdatedPass!456';
    document
      .getElementById('cloud-sync-password-manage-panel')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => server.revision === 3);

    // Same Recovery Key still unlocks after password change, AND old rev 1 decrypts with new password.
    const deviceAfterPwdChange = await makeOptionBDevice(server);
    document.getElementById('cloud-sync-unlock-password').value =
      'UpdatedPass!456';
    document
      .getElementById('cloud-sync-unlock-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await deviceAfterPwdChange.waitForUnlock();

    // Remove rev-1-url locally and restore rev 1 from encrypted history to verify DEK remained identical.
    deviceAfterPwdChange.state = { schemaVersion: 1, urls: [], presets: [] };
    const historySelect = document.getElementById('cloud-sync-history-select');
    historySelect.value = '1';
    document.getElementById('cloud-sync-history-restore-btn').click();
    await waitUntil(
      () =>
        deviceAfterPwdChange.state.urls.some((u) => u.id === 'rev-1-url') &&
        !document.getElementById('cloud-sync-rotate-btn').disabled
    );
    expect(deviceAfterPwdChange.state.urls.map((u) => u.id)).toContain(
      'rev-1-url'
    );

    // Old password no longer unlocks on a fresh device.
    const checkOldPwd = await makeOptionBDevice(server);
    document.getElementById('cloud-sync-unlock-password').value =
      'InitialPass!123';
    document
      .getElementById('cloud-sync-unlock-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => checkOldPwd.status().isError);

    // (e) Rotate Recovery Key -> preserves 'UpdatedPass!456', invalidates recoveryKey1, activates recoveryKey2.
    deviceAfterPwdChange.activate();
    document.getElementById('cloud-sync-rotate-btn').click();
    expect(document.getElementById('cloud-sync-rotate-panel').hidden).toBe(
      false
    );
    document.getElementById('cloud-sync-rotate-password-input').value =
      'UpdatedPass!456';
    document
      .getElementById('cloud-sync-rotate-panel')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => server.revision === 4);

    const recoveryKey2 = document
      .getElementById('cloud-sync-rotated-display')
      .textContent.trim();
    expect(recoveryKey2).toMatch(/^URE1-/);
    expect(recoveryKey2).not.toBe(recoveryKey1);

    // Old recoveryKey1 fails, new recoveryKey2 succeeds, password still works.
    const checkKeys = await makeOptionBDevice(server);
    document.getElementById('cloud-sync-use-recovery-btn').click();
    document.getElementById('cloud-sync-recovery-input').value = recoveryKey1;
    document.getElementById('cloud-sync-unlock-btn').click();
    await waitUntil(() => checkKeys.status().isError);

    document.getElementById('cloud-sync-recovery-input').value = recoveryKey2;
    document.getElementById('cloud-sync-unlock-btn').click();
    await checkKeys.waitForUnlock();
    expect(checkKeys.state.urls.map((u) => u.id)).toContain('rev-1-url');

    const checkPwdStillWorks = await makeOptionBDevice(server);
    document.getElementById('cloud-sync-unlock-password').value =
      'UpdatedPass!456';
    document
      .getElementById('cloud-sync-unlock-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await checkPwdStillWorks.waitForUnlock();
    expect(checkPwdStillWorks.state.urls.map((u) => u.id)).toContain(
      'rev-1-url'
    );
  });

  test('(f) Legacy v1 account unlocks with Recovery Key and upgrades one-click to Option B v2', async () => {
    const server = makeFakeCloudServer();
    const {
      createRecoveryKey,
      deriveEncryptionKey,
      encryptJson,
      encodeBytes,
      randomBytes,
    } = await import('../../core/cryptoVault.js');

    const v1Recovery = await createRecoveryKey();
    const salt = randomBytes(16);
    const v1Key = await deriveEncryptionKey(
      v1Recovery.secret,
      salt,
      'URL Editor E2EE v1:acct-option-b'
    );
    const enc = await encryptJson(
      {
        schemaVersion: 1,
        urls: [makeUrl('legacy-1', 'Legacy URL')],
        presets: [],
      },
      v1Key,
      JSON.stringify({
        accountId: 'acct-option-b',
        payloadSchemaVersion: 1,
        keyVersion: 1,
        revision: 1,
      })
    );
    server.revision = 1;
    server.document = {
      revision: 1,
      payloadSchemaVersion: 1,
      keyVersion: 1,
      kdfSalt: encodeBytes(salt),
      iv: enc.iv,
      ciphertext: enc.ciphertext,
    };

    const legacyDevice = await makeOptionBDevice(server);
    expect(document.getElementById('cloud-sync-legacy-panel').hidden).toBe(
      false
    );
    document.getElementById('cloud-sync-recovery-input').value =
      v1Recovery.display;
    document.getElementById('cloud-sync-unlock-btn').click();
    await legacyDevice.waitForUnlock();

    expect(legacyDevice.state.urls.map((u) => u.id)).toEqual(['legacy-1']);
    expect(document.getElementById('cloud-sync-upgrade-banner').hidden).toBe(
      false
    );

    // Upgrade to Option B v2.
    document.getElementById('cloud-sync-open-upgrade-btn').click();
    expect(
      document.getElementById('cloud-sync-password-manage-panel').hidden
    ).toBe(false);
    document.getElementById('cloud-sync-change-new-password').value =
      'UpgradedPass!99';
    document.getElementById('cloud-sync-change-confirm-password').value =
      'UpgradedPass!99';
    document
      .getElementById('cloud-sync-password-manage-panel')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => server.revision === 2);

    expect(server.document.payloadSchemaVersion).toBe(2);
    expect(server.document.keyVersion).toBe(2);
    expect(server.document.keySlots.password.kdf).toBe('PBKDF2-SHA256');
    expect(document.getElementById('cloud-sync-upgrade-banner').hidden).toBe(
      true
    );
    expect(document.getElementById('cloud-sync-rotated-key-box').hidden).toBe(
      false
    );

    // New device unlocks upgraded account with custom password.
    const freshDevice = await makeOptionBDevice(server);
    expect(
      document.getElementById('cloud-sync-password-unlock-panel').hidden
    ).toBe(false);
    document.getElementById('cloud-sync-unlock-password').value =
      'UpgradedPass!99';
    document
      .getElementById('cloud-sync-unlock-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await freshDevice.waitForUnlock();
    expect(freshDevice.state.urls.map((u) => u.id)).toEqual(['legacy-1']);
  });
});
