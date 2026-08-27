/**
 * Leader election using BroadcastChannel API.
 * Ensures only one tab performs sync operations at a time, and hands
 * leadership to another tab if the leader closes or crashes.
 */

const ELECTION_WINDOW_MS = 150;
const HEARTBEAT_INTERVAL_MS = 5000;
const LEADER_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;

type ElectionMessage =
  | { type: 'election'; tabId: string; createdAt: number }
  | { type: 'election-response'; tabId: string; createdAt: number; isLeader: boolean }
  | { type: 'leader'; tabId: string; createdAt: number }
  | { type: 'heartbeat'; tabId: string; createdAt: number }
  | { type: 'resign'; tabId: string };

export class LeaderElection {
  private channel: BroadcastChannel | null;
  private isLeaderFlag = false;
  private readonly tabId: string;
  private readonly createdAt: number;
  private heartbeatInterval?: number;
  private monitorInterval?: number;
  private lastLeaderSeenAt = Date.now();
  private onLeaderChange?: (isLeader: boolean) => void;
  private sawExistingLeader = false;
  private collectingResponses = false;

  constructor(channelName = 'dexie-sync-leader') {
    this.createdAt = Date.now();
    this.tabId = `tab-${this.createdAt}-${Math.random().toString(36).slice(2, 9)}`;

    if (typeof BroadcastChannel === 'undefined') {
      // No cross-context coordination available (SSR, worker, older browser).
      // There's nothing to coordinate with, so act as the sole leader.
      this.channel = null;
      this.isLeaderFlag = true;
      return;
    }

    this.channel = new BroadcastChannel(channelName);
    this.setupListeners();

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleUnload);
    }
  }

  private handleUnload = (): void => {
    if (this.isLeaderFlag) {
      this.channel?.postMessage({ type: 'resign', tabId: this.tabId });
    }
  };

  private rankOf(tabId: string, createdAt: number): string {
    // Zero-padded so lexicographic and numeric ordering agree.
    return `${String(createdAt).padStart(20, '0')}:${tabId}`;
  }

  private get selfRank(): string {
    return this.rankOf(this.tabId, this.createdAt);
  }

  private setupListeners() {
    if (!this.channel) return;

    this.channel.onmessage = (event: MessageEvent<ElectionMessage>) => {
      const data = event.data;
      if (!data || data.tabId === this.tabId) return;

      switch (data.type) {
        case 'election':
          this.channel?.postMessage({
            type: 'election-response',
            tabId: this.tabId,
            createdAt: this.createdAt,
            isLeader: this.isLeaderFlag,
          } satisfies ElectionMessage);
          break;

        case 'election-response':
          if (this.collectingResponses && data.isLeader) {
            this.sawExistingLeader = true;
          }
          break;

        case 'leader':
          this.lastLeaderSeenAt = Date.now();
          // Both sides may have declared leadership concurrently; the lower
          // rank wins so every tab converges on the same winner.
          if (this.isLeaderFlag && this.rankOf(data.tabId, data.createdAt) < this.selfRank) {
            this.stepDown();
          }
          break;

        case 'heartbeat':
          this.lastLeaderSeenAt = Date.now();
          break;

        case 'resign':
          this.lastLeaderSeenAt = 0;
          if (!this.isLeaderFlag) {
            this.electLeader().catch(() => {});
          }
          break;
      }
    };
  }

  async electLeader(): Promise<boolean> {
    if (!this.channel) {
      return this.isLeaderFlag;
    }

    this.sawExistingLeader = false;
    this.collectingResponses = true;
    this.channel.postMessage({
      type: 'election',
      tabId: this.tabId,
      createdAt: this.createdAt,
    } satisfies ElectionMessage);

    await new Promise((resolve) => setTimeout(resolve, ELECTION_WINDOW_MS));

    this.collectingResponses = false;

    if (this.sawExistingLeader) {
      // Never steal leadership from a tab that's already running sync.
      this.isLeaderFlag = false;
    } else {
      // Nobody else claims leadership. Declare it; if another tab reached the
      // same conclusion at the same time, the 'leader' handler below
      // deterministically resolves the resulting collision by rank.
      this.becomeLeader();
    }

    this.startMonitor();

    return this.isLeaderFlag;
  }

  private becomeLeader() {
    this.isLeaderFlag = true;
    this.channel?.postMessage({
      type: 'leader',
      tabId: this.tabId,
      createdAt: this.createdAt,
    } satisfies ElectionMessage);
    this.startHeartbeat();
    this.onLeaderChange?.(true);
  }

  private stepDown() {
    this.isLeaderFlag = false;
    this.stopHeartbeat();
    this.onLeaderChange?.(false);
  }

  isLeader(): boolean {
    return this.isLeaderFlag;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      if (this.isLeaderFlag) {
        this.channel?.postMessage({
          type: 'heartbeat',
          tabId: this.tabId,
          createdAt: this.createdAt,
        } satisfies ElectionMessage);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /** Watches for a missing leader (crashed/closed tab) and re-runs the election. */
  private startMonitor() {
    if (this.monitorInterval || !this.channel) return;

    this.lastLeaderSeenAt = Date.now();
    this.monitorInterval = window.setInterval(() => {
      if (this.isLeaderFlag) return;
      if (Date.now() - this.lastLeaderSeenAt > LEADER_TIMEOUT_MS) {
        this.electLeader().catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopMonitor() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  onLeadershipChange(callback: (isLeader: boolean) => void) {
    this.onLeaderChange = callback;
  }

  resign() {
    if (this.isLeaderFlag) {
      this.channel?.postMessage({ type: 'resign', tabId: this.tabId });
    }
    this.stepDown();
  }

  destroy() {
    this.resign();
    this.stopMonitor();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleUnload);
    }
    this.channel?.close();
  }
}
