import { describe, it, expect, afterEach, vi } from 'vitest';
import { LeaderElection } from '../src/utils/leader-election';

describe('LeaderElection', () => {
  const instances: LeaderElection[] = [];

  function create(channelName: string): LeaderElection {
    const instance = new LeaderElection(channelName);
    instances.push(instance);
    return instance;
  }

  afterEach(() => {
    instances.splice(0).forEach((instance) => instance.destroy());
  });

  it('becomes leader when no other tab is present', async () => {
    const a = create('le-alone');
    await expect(a.electLeader()).resolves.toBe(true);
    expect(a.isLeader()).toBe(true);
  });

  it('does not let a newly-opened tab steal leadership from an active leader', async () => {
    const channel = 'le-no-steal';
    const a = create(channel);
    await a.electLeader();
    expect(a.isLeader()).toBe(true);

    const b = create(channel);
    const bWon = await b.electLeader();

    expect(bWon).toBe(false);
    expect(b.isLeader()).toBe(false);
    expect(a.isLeader()).toBe(true);
  });

  it('resolves a simultaneous election deterministically to exactly one leader', async () => {
    const channel = 'le-race';
    const a = create(channel);
    const b = create(channel);
    const c = create(channel);

    await Promise.all([a.electLeader(), b.electLeader(), c.electLeader()]);

    // Collisions are resolved asynchronously via 'leader' messages exchanged
    // after each tab's own election window closes; give that a moment.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const leaders = [a, b, c].filter((instance) => instance.isLeader());
    expect(leaders).toHaveLength(1);
  });

  it('fails over to a follower when the leader resigns', async () => {
    const channel = 'le-failover';
    const a = create(channel);
    await a.electLeader();

    const b = create(channel);
    await b.electLeader();
    expect(b.isLeader()).toBe(false);

    a.resign();
    expect(a.isLeader()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(b.isLeader()).toBe(true);
  });

  it('acts as sole leader instead of throwing when BroadcastChannel is unavailable (SSR)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      const instance = create('le-no-bc');
      expect(instance.isLeader()).toBe(true);
      await expect(instance.electLeader()).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
