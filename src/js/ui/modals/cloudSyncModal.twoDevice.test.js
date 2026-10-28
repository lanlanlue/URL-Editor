/**
 * B12: auto-sync must merge, not overwrite. Several real modal instances (one
 * per simulated device, each with its own module state) talk to one fake
 * cloudApi that implements ETag / If-Match exactly like src/server/api.js
 * handleSyncPut (ETag "rev-N", 409 when If-Match or envelope.revision is not
 * current + 1). Only cloudApi, cryptoVault and secureStorage are mocked; the
 * real markup, syncMerge and modal code run.
 */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function makeServer() {
  const server = {
    envelope: null,
    revision: 0,
    gets: 0,
    puts: [], // { ifMatch, revision, accepted }
    afterGet: null,
    gate: null, // one-shot promise that delays the next GET
    // Writes a document as another device would (no If-Match involved).
    write(data) {
      server.revision += 1;
      server.envelope = {
        revision: server.revision,
        keyVersion: 1,
        kdfSalt: 'salt',
        iv: 'iv',
        ciphertext: JSON.stringify(data),
      };
    },
    data() {
      return server.envelope ? JSON.parse(server.envelope.ciphertext) : null;
    },
    ids() {
      return (server.data()?.urls || []).map((u) => u.id).sort();
    },
  };
  return server;
}

async function makeDevice(
  server,
  { local, unreadableGuest = false, storedKey = false }
) {
  jest.resetModules();
  document.body.innerHTML = '';
  class CloudApiError extends Error {
    constructor(message, { status = 0 } = {}) {
      super(message);
      this.status = status;
    }
  }
  const secure = {
    clearGuestState: jest.fn().mockResolvedValue(undefined),
    deleteCurrentAccountLocalState: jest.fn(),
    getAccountEncryptionKey: jest
      .fn()
      .mockResolvedValue(
        storedKey ? { key: 'stored-key', salt: 'salt', keyVersion: 1 } : null
      ),
    getStorageMode: jest.fn(() => 'indexeddb'),
    loadAccountState: jest.fn().mockResolvedValue(null),
    useAccountEncryptionKey: jest.fn().mockResolvedValue(undefined),
    hasUnreadableGuestRecord: jest.fn(() => unreadableGuest),
    isStorageUnreadable: jest.fn(() => false),
  };
  const api = {
    CloudApiError,
    deleteAccount: jest.fn(),
    getSession: jest.fn().mockResolvedValue({
      csrfToken: 'csrf',
      user: { id: 'acct-1', email: 'a@b.test' },
    }),
    getSyncRevision: jest.fn(),
    getSyncDocument: jest.fn(async () => {
      server.gets += 1;
      if (server.gate) {
        const gate = server.gate;
        server.gate = null;
        await gate;
      }
      const result = {
        document: server.envelope,
        etag: `"rev-${server.revision}"`,
        revision: server.revision,
      };
      if (server.afterGet) server.afterGet();
      return result;
    }),
    listSyncRevisions: jest.fn().mockResolvedValue([]),
    logout: jest.fn(),
    putSyncDocument: jest.fn(async (envelope, _csrf, etag = '"rev-0"') => {
      const match = /^"rev-(\d+)"$/.exec(etag);
      const entry = { ifMatch: etag, revision: envelope.revision };
      server.puts.push(entry);
      if (!match) throw new CloudApiError('If-Match required', { status: 422 });
      if (
        Number(match[1]) !== server.revision ||
        envelope.revision !== server.revision + 1
      ) {
        entry.accepted = false;
        throw new CloudApiError('conflict', { status: 409 });
      }
      entry.accepted = true;
      server.revision = envelope.revision;
      server.envelope = envelope;
      return { document: envelope, etag: `"rev-${server.revision}"` };
    }),
  };
  const vault = {
    createRecoveryKey: jest.fn(),
    decodeBytes: jest.fn(() => new Uint8Array(16)),
    decryptJson: jest.fn(async (envelope) => JSON.parse(envelope.ciphertext)),
    deriveEncryptionKey: jest.fn().mockResolvedValue('derived-key'),
    encryptJson: jest.fn(async (payload) => ({
      iv: 'iv',
      ciphertext: JSON.stringify(payload),
    })),
    encodeBytes: jest.fn(() => 'salt'),
    parseRecoveryKey: jest.fn().mockResolvedValue('secret'),
    randomBytes: jest.fn(() => new Uint8Array(16)),
  };
  jest.doMock('../../core/secureStorage.js', () => secure);
  jest.doMock('../../core/cloudApi.js', () => api);
  jest.doMock('../../core/cryptoVault.js', () => vault);
  jest.doMock('../../core/runtimeConfig.js', () => ({ CLOUD_ENABLED: true }));
  jest.doMock('../../core/i18n.js', () => ({
    __esModule: true,
    default: { t: (key, opts) => opts?.defaultValue ?? key },
  }));

  const device = { state: local, secure, api };
  device.getData = jest.fn(() => device.state);
  device.onRestore = jest.fn((data) => {
    device.state = data;
  });
  const mod = await import('./cloudSyncModal.js');
  mod.initCloudSyncModal({
    getData: device.getData,
    onRestore: device.onRestore,
  });
  await flush();
  // Keep this device's DOM (with its listeners) so it can be swapped back in.
  device.nodes = Array.from(document.body.childNodes);
  device.activate = () => document.body.replaceChildren(...device.nodes);
  device.activate();
  if (!storedKey) {
    document.getElementById('cloud-sync-recovery-input').value = 'KEY';
    document.getElementById('cloud-sync-unlock-btn').click();
    await flush();
  }
  device.upload = async () => {
    device.activate();
    document.getElementById('cloud-sync-upload-btn').click();
    await flush();
  };
  device.status = () => {
    device.activate();
    const el = document.getElementById('cloud-sync-status');
    return {
      text: el.textContent,
      isError: el.classList.contains('text-error'),
    };
  };
  device.ids = () => device.state.urls.map((u) => u.id).sort();
  return device;
}

const url = (id, updatedAt, extra = {}) => ({
  id,
  url: `https://${id}.test`,
  updatedAt,
  ...extra,
});
const data = (urls, tombstones = []) => ({
  schemaVersion: 1,
  urls,
  presets: [],
  tombstones,
});

describe('B12 stale device must merge instead of overwrite', () => {
  test('(1) stale device B uploads after A: remote keeps both edits', async () => {
    const server = makeServer();
    const b = await makeDevice(server, { local: data([url('b1', 20)]) });
    const a = await makeDevice(server, { local: data([url('a1', 10)]) });
    await a.upload(); // remote rev 1 = {a1}
    expect(server.ids()).toEqual(['a1']);

    await b.upload(); // B last saw rev 0, remote is now rev 1
    expect(server.ids()).toEqual(['a1', 'b1']);
    expect(server.revision).toBe(2);
    expect(b.ids()).toEqual(['a1', 'b1']); // B restored the merged state
    expect(b.status().isError).toBe(false);
  });

  test('(2a) B deleted an entry that A edited later: the later edit wins', async () => {
    const server = makeServer();
    server.write(data([url('e1', 100)]));
    const a = await makeDevice(server, { local: data([]) });
    const b = await makeDevice(server, { local: data([]) });
    expect(a.ids()).toEqual(['e1']);
    expect(b.ids()).toEqual(['e1']);

    a.state = data([url('e1', 400, { url: 'https://edited-by-a.test' })]);
    await a.upload(); // rev 2
    b.state = data([], [{ id: 'e1', deletedAt: 300 }]);
    await b.upload();

    expect(server.revision).toBe(3);
    expect(server.data().urls).toEqual([
      expect.objectContaining({ id: 'e1', url: 'https://edited-by-a.test' }),
    ]);
    expect(b.ids()).toEqual(['e1']);
  });

  test("(2b) B deleted an entry that A edited earlier: the delete wins and A's new entry survives", async () => {
    const server = makeServer();
    server.write(data([url('e1', 100)]));
    const a = await makeDevice(server, { local: data([]) });
    const b = await makeDevice(server, { local: data([]) });

    a.state = data([url('e1', 200), url('a2', 250)]);
    await a.upload(); // rev 2
    b.state = data([], [{ id: 'e1', deletedAt: 300 }]);
    await b.upload();

    expect(server.revision).toBe(3);
    // a2 was only ever uploaded by A; a stale overwrite by B would drop it.
    expect(server.ids()).toEqual(['a2']);
    expect(server.data().tombstones).toEqual([
      expect.objectContaining({ id: 'e1', deletedAt: 300 }),
    ]);
  });

  test('(3) an up-to-date device uploads with no GET before the PUT', async () => {
    const server = makeServer();
    const a = await makeDevice(server, { local: data([url('a1', 10)]) });
    const getsAfterUnlock = server.gets;
    await a.upload();
    expect(server.gets).toBe(getsAfterUnlock);
    expect(server.puts).toEqual([
      { ifMatch: '"rev-0"', revision: 1, accepted: true },
    ]);

    a.state = data([url('a1', 10), url('a2', 20)]);
    await a.upload();
    expect(server.gets).toBe(getsAfterUnlock);
    expect(server.puts[1]).toEqual({
      ifMatch: '"rev-1"',
      revision: 2,
      accepted: true,
    });
    expect(server.ids()).toEqual(['a1', 'a2']);
  });

  test('(4) a persistent conflict ends in an error after one retry, never an overwrite', async () => {
    const server = makeServer();
    const b = await makeDevice(server, { local: data([url('b1', 20)]) });
    server.write(data([url('c0', 1)]));
    // Every read is followed by another device writing, so B can never win.
    let n = 0;
    server.afterGet = () => {
      n += 1;
      server.write(data([url(`c${n}`, 1)]));
    };
    const putsBefore = server.puts.length;
    const getsBefore = server.gets;
    server.getsAtFirstPut = null;
    const originalPut = b.api.putSyncDocument.getMockImplementation();
    b.api.putSyncDocument.mockImplementation(async (...args) => {
      if (server.getsAtFirstPut === null) server.getsAtFirstPut = server.gets;
      return originalPut(...args);
    });
    await b.upload();

    // The first PUT is sent without any GET before it (synced etag is used).
    expect(server.getsAtFirstPut).toBe(getsBefore);
    const attempts = server.puts.slice(putsBefore);
    expect(attempts).toHaveLength(2); // original + exactly one retry
    expect(attempts[0].ifMatch).not.toBe(attempts[1].ifMatch);
    expect(attempts.every((p) => p.accepted === false)).toBe(true);
    expect(server.ids().includes('b1')).toBe(false); // nothing of B was written
    expect(b.status().isError).toBe(true);
  });

  test('(6) the first upload to an empty remote uses If-Match rev-0 and revision 1', async () => {
    const server = makeServer();
    const a = await makeDevice(server, { local: data([url('a1', 10)]) });
    const gets = server.gets;
    await a.upload();
    expect(server.gets).toBe(gets);
    expect(server.puts).toEqual([
      { ifMatch: '"rev-0"', revision: 1, accepted: true },
    ]);
    expect(server.ids()).toEqual(['a1']);
    expect(a.status().isError).toBe(false);
  });

  test('(6b) a racing first upload merges the other device and retries once', async () => {
    const server = makeServer();
    const a = await makeDevice(server, { local: data([url('a1', 10)]) });
    server.write(data([url('x1', 5)])); // another device created the document
    await a.upload();
    expect(server.ids()).toEqual(['a1', 'x1']);
    expect(server.puts.map((p) => p.accepted)).toEqual([false, true]);
  });
});

describe('B12 never-synced fallback', () => {
  test('(7) an auto-upload that fires before the session refresh finished merges the remote first', async () => {
    const server = makeServer();
    server.write(data([url('r1', 5)]));
    let release;
    server.gate = new Promise((resolve) => {
      release = resolve;
    });
    // Stored key: encryptionContext is set while the refresh GET is pending.
    const a = await makeDevice(server, {
      local: data([url('a1', 10)]),
      storedKey: true,
    });
    a.activate();
    jest.useFakeTimers();
    try {
      window.dispatchEvent(
        new CustomEvent('url-editor-data-change', { detail: a.state })
      );
      await jest.advanceTimersByTimeAsync(2000);
      expect(server.puts).toEqual([
        { ifMatch: '"rev-1"', revision: 2, accepted: true },
      ]);
      expect(server.ids()).toEqual(['a1', 'r1']);
    } finally {
      jest.useRealTimers();
      release();
      await flush();
    }
    expect(server.ids()).toEqual(['a1', 'r1']);
  });
});

describe('B12 interactions that must keep working', () => {
  test('(5a) guest migration is cleared once, only after the retried upload succeeds', async () => {
    const server = makeServer();
    const a = await makeDevice(server, { local: data([url('g1', 10)]) });
    server.write(data([url('x1', 5)]));
    expect(a.secure.clearGuestState).not.toHaveBeenCalled();
    await a.upload();
    expect(server.ids()).toEqual(['g1', 'x1']);
    expect(a.secure.clearGuestState).toHaveBeenCalledTimes(1);
  });

  test('(5b) a failed upload does not clear guest state', async () => {
    const server = makeServer();
    const a = await makeDevice(server, { local: data([url('g1', 10)]) });
    let n = 0;
    server.afterGet = () => {
      n += 1;
      server.write(data([url(`c${n}`, 1)]));
    };
    server.write(data([url('c0', 1)]));
    const staleEtag = `"rev-${server.revision}"`;
    // Device synced when the remote was empty ("rev-0"); the remote has since
    // moved on, so a synced-etag PUT must differ from the fresh etag.
    await a.upload();
    expect(server.puts[0].ifMatch).toBe('"rev-0"');
    expect(server.puts[0].ifMatch).not.toBe(staleEtag);
    expect(a.secure.clearGuestState).not.toHaveBeenCalled();
    expect(a.status().isError).toBe(true);
  });

  test('(5c) the unreadable-guest placeholder is never uploaded, even when the remote moved', async () => {
    const server = makeServer();
    const a = await makeDevice(server, {
      local: data([{ id: 'placeholder-guest', url: 'https://p.test' }]),
      unreadableGuest: true,
    });
    server.write(data([url('x1', 5)]));
    const gets = server.gets;
    await a.upload();
    expect(server.puts).toEqual([]);
    expect(server.gets).toBe(gets);
    expect(a.status().text).not.toBe('');

    // A save carrying real data lifts the guard; the upload then merges.
    a.state = data([url('real1', 50)]);
    window.dispatchEvent(
      new CustomEvent('url-editor-data-change', { detail: a.state })
    );
    await a.upload();
    expect(server.ids()).toEqual(['real1', 'x1']);
  });
});

describe('B27 automatic retries stop after repeated 409 conflicts', () => {
  async function conflictingDevice() {
    const server = makeServer();
    server.write(data([url('r1', 5)]));
    const a = await makeDevice(server, {
      local: data([url('a1', 10)]),
      storedKey: true,
    });
    a.activate();
    const { CloudApiError } = a.api;
    a.api.putSyncDocument.mockImplementation(async () => {
      throw new CloudApiError('conflict', { status: 409 });
    });
    return { a };
  }
  const edit = (a) =>
    window.dispatchEvent(
      new CustomEvent('url-editor-data-change', { detail: a.state })
    );

  test('caps automatic attempts, surfaces a status, and a new edit re-arms', async () => {
    const { a } = await conflictingDevice();
    jest.useFakeTimers();
    try {
      edit(a);
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000); // one hour
      // 5 automatic attempts x (PUT + one merge-and-retry PUT) = 10, not ~120.
      expect(a.api.putSyncDocument).toHaveBeenCalledTimes(10);
      const status = a.status();
      expect(status.isError).toBe(true);
      expect(status.text).toContain('自動同步因反覆衝突而暫停');

      // The next local edit starts a fresh cycle.
      edit(a);
      await jest.advanceTimersByTimeAsync(2000);
      expect(a.api.putSyncDocument.mock.calls.length).toBeGreaterThan(10);
    } finally {
      jest.useRealTimers();
    }
  });

  test('conflicts below the cap still recover automatically', async () => {
    const { a } = await conflictingDevice();
    const { CloudApiError } = a.api;
    let calls = 0;
    a.api.putSyncDocument.mockImplementation(async (envelope) => {
      calls += 1;
      if (calls <= 4) throw new CloudApiError('conflict', { status: 409 });
      return { document: envelope, etag: '"rev-9"', revision: 9 };
    });
    jest.useFakeTimers();
    try {
      edit(a);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      // 2 failing attempts (4 PUTs), then the third attempt succeeds.
      expect(calls).toBe(5);
      // Recovered below the cap: no further automatic attempts follow.
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(calls).toBe(5);
    } finally {
      jest.useRealTimers();
    }
  });
});
