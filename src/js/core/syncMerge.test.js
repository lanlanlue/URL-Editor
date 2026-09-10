import { compareSyncEntities, mergeSyncData } from './syncMerge.js';

describe('syncMerge', () => {
  test('merges different URL entries and keeps the latest same-entry version', () => {
    const merged = mergeSyncData(
      {
        urls: [
          {
            id: 'local',
            url: 'https://local.example',
            syncUpdatedAt: 10,
            syncDeviceId: 'a',
          },
          {
            id: 'same',
            url: 'https://old.example',
            syncUpdatedAt: 10,
            syncDeviceId: 'a',
          },
        ],
      },
      {
        urls: [
          {
            id: 'remote',
            url: 'https://remote.example',
            syncUpdatedAt: 20,
            syncDeviceId: 'b',
          },
          {
            id: 'same',
            url: 'https://new.example',
            syncUpdatedAt: 20,
            syncDeviceId: 'b',
          },
        ],
      }
    );

    expect(merged.urls.map((entry) => entry.id)).toEqual([
      'local',
      'same',
      'remote',
    ]);
    expect(merged.urls.find((entry) => entry.id === 'same').url).toBe(
      'https://new.example'
    );
  });

  test('does not resurrect an entry newer than a deletion tombstone', () => {
    const merged = mergeSyncData(
      {
        urls: [
          {
            id: 'deleted',
            url: 'https://old.example',
            syncUpdatedAt: 10,
            syncDeviceId: 'a',
          },
        ],
      },
      {
        tombstones: [
          {
            id: 'deleted',
            deletedAt: 20,
            syncUpdatedAt: 20,
            syncDeviceId: 'b',
          },
        ],
      }
    );
    expect(merged.urls).toHaveLength(0);
  });

  test('uses device id as deterministic tie breaker', () => {
    expect(
      compareSyncEntities(
        { syncUpdatedAt: 10, syncDeviceId: 'device-b' },
        { syncUpdatedAt: 10, syncDeviceId: 'device-a' }
      )
    ).toBeGreaterThan(0);
  });
});
