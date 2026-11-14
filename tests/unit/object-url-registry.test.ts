import { describe, expect, it, vi } from 'vitest';
import {
  ObjectUrlRegistry,
  type UrlObjectAdapter,
} from '../../src/services/source-player/object-url-registry';

describe('ObjectUrlRegistry', () => {
  function createMockAdapter() {
    let counter = 0;
    const created: string[] = [];
    const revoked: string[] = [];

    const adapter: UrlObjectAdapter = {
      createObjectURL: vi.fn(() => {
        counter += 1;
        const url = `blob:reactstage/${counter}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revoked.push(url);
      }),
    };

    return { adapter, created, revoked };
  }

  it('allocates a primary URL and revokes the previous URL on replacement', () => {
    const { adapter, revoked } = createMockAdapter();
    const registry = new ObjectUrlRegistry(adapter);

    const url1 = registry.replacePrimary(new Blob(['video-1']));
    expect(url1).toBe('blob:reactstage/1');
    expect(registry.getActiveCount()).toBe(1);
    expect(revoked).toEqual([]);

    const url2 = registry.replacePrimary(new Blob(['video-2']));
    expect(url2).toBe('blob:reactstage/2');
    expect(registry.getActiveCount()).toBe(1);
    expect(registry.getCurrentPrimaryUrl()).toBe('blob:reactstage/2');
    expect(revoked).toEqual(['blob:reactstage/1']);
  });

  it('ignores duplicate or unknown revocations safely', () => {
    const { adapter, revoked } = createMockAdapter();
    const registry = new ObjectUrlRegistry(adapter);

    const url = registry.replacePrimary(new Blob(['video']));
    registry.revoke(null);
    registry.revoke(undefined);
    registry.revoke('blob:unknown/999');
    expect(revoked).toEqual([]);

    registry.revoke(url);
    registry.revoke(url);
    expect(revoked).toEqual(['blob:reactstage/1']);
    expect(registry.getActiveCount()).toBe(0);
    expect(registry.getCurrentPrimaryUrl()).toBeNull();
  });

  it('revokes all tracked URLs during full cleanup', () => {
    const { adapter, revoked } = createMockAdapter();
    const registry = new ObjectUrlRegistry(adapter);

    registry.replacePrimary(new Blob(['video-a']));
    registry.revokeAll();

    expect(revoked).toEqual(['blob:reactstage/1']);
    expect(registry.getActiveCount()).toBe(0);
    expect(registry.getActiveUrls().size).toBe(0);
  });
});
