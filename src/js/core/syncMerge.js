const DEFAULT_DEVICE_KEY = 'urlEditorDeviceId';

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(storage) {
  const targetStorage =
    storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!targetStorage) return 'device-unknown';
  try {
    const existing = targetStorage.getItem(DEFAULT_DEVICE_KEY);
    if (existing) return existing;
    const next = createId();
    targetStorage.setItem(DEFAULT_DEVICE_KEY, next);
    return next;
  } catch {
    return 'device-unknown';
  }
}

function entityTimestamp(entity) {
  return Number.isFinite(entity?.syncUpdatedAt)
    ? entity.syncUpdatedAt
    : Number.isFinite(entity?.updatedAt)
      ? entity.updatedAt
      : Number.isFinite(entity?.deletedAt)
        ? entity.deletedAt
        : Number.isFinite(entity?.createdAt)
          ? entity.createdAt
          : 0;
}

function entityDevice(entity) {
  return typeof entity?.syncDeviceId === 'string' ? entity.syncDeviceId : '';
}

function compareEntities(left, right) {
  const timestampDifference = entityTimestamp(left) - entityTimestamp(right);
  if (timestampDifference !== 0) return timestampDifference;
  return entityDevice(left).localeCompare(entityDevice(right));
}

function chooseEntity(left, right) {
  if (!left) return right;
  if (!right) return left;
  return compareEntities(left, right) >= 0 ? left : right;
}

function mergeEntityLists(local = [], remote = []) {
  const byId = new Map();
  [...local, ...remote].forEach((entity) => {
    if (!entity || typeof entity.id !== 'string') return;
    byId.set(entity.id, chooseEntity(byId.get(entity.id), entity));
  });
  return [...byId.values()];
}

function tombstoneKey(tombstone) {
  return typeof tombstone?.id === 'string' ? tombstone.id : '';
}

function mergeTombstones(local = [], remote = []) {
  const byId = new Map();
  [...local, ...remote].forEach((tombstone) => {
    const id = tombstoneKey(tombstone);
    if (!id) return;
    byId.set(id, chooseEntity(byId.get(id), tombstone));
  });
  return [...byId.values()];
}

export function mergeSyncData(local = {}, remote = {}) {
  const mergedTombstones = mergeTombstones(local.tombstones, remote.tombstones);
  const tombstoneMap = new Map(mergedTombstones.map((item) => [item.id, item]));
  const mergedUrls = mergeEntityLists(local.urls, remote.urls).filter(
    (entry) => {
      const tombstone = tombstoneMap.get(entry.id);
      return !tombstone || compareEntities(entry, tombstone) > 0;
    }
  );
  const mergedPresets = mergeEntityLists(local.presets, remote.presets).filter(
    (entry) => {
      const tombstone = tombstoneMap.get(`preset:${entry.id}`);
      return !tombstone || compareEntities(entry, tombstone) > 0;
    }
  );

  const remoteMeta = remote.syncMetadata || {};
  const localMeta = local.syncMetadata || {};
  const useRemoteView =
    Number(remoteMeta.updatedAt || 0) > Number(localMeta.updatedAt || 0) ||
    (Number(remoteMeta.updatedAt || 0) === Number(localMeta.updatedAt || 0) &&
      String(remoteMeta.deviceId || '').localeCompare(
        String(localMeta.deviceId || '')
      ) >= 0);

  return {
    schemaVersion: 1,
    urls: mergedUrls,
    presets: mergedPresets,
    sortMode: useRemoteView
      ? remote.sortMode || local.sortMode || 'created'
      : local.sortMode || 'created',
    viewMode: useRemoteView
      ? remote.viewMode || local.viewMode || 'cards'
      : local.viewMode || 'cards',
    tombstones: mergedTombstones,
    syncMetadata: {
      updatedAt: Math.max(
        Number(localMeta.updatedAt || 0),
        Number(remoteMeta.updatedAt || 0)
      ),
      deviceId: useRemoteView
        ? remoteMeta.deviceId || localMeta.deviceId
        : localMeta.deviceId || remoteMeta.deviceId,
    },
  };
}

export function createSyncMetadata(deviceId, updatedAt = Date.now()) {
  return { deviceId: deviceId || getDeviceId(), updatedAt };
}

export function compareSyncEntities(left, right) {
  return compareEntities(left, right);
}

export default {
  getDeviceId,
  mergeSyncData,
  createSyncMetadata,
  compareSyncEntities,
};
