/**
 * Leader election using BroadcastChannel API
 * Ensures only one tab performs sync operations
 */
export class LeaderElection {
  private channel: BroadcastChannel;
  private isLeaderFlag = false;
  private tabId: string;
  private heartbeatInterval?: number;
  private electionTimeout?: number;
  private onLeaderChange?: (isLeader: boolean) => void;

  constructor(channelName = 'dexie-sync-leader') {
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.channel = new BroadcastChannel(channelName);
    this.setupListeners();
  }

  private setupListeners() {
    this.channel.onmessage = (event) => {
      const { type, tabId, timestamp } = event.data;

      switch (type) {
        case 'election':
          // Respond with our timestamp
          this.channel.postMessage({
            type: 'election-response',
            tabId: this.tabId,
            timestamp: Date.now(),
          });
          break;

        case 'election-response':
          // If another tab has earlier timestamp, they win
          if (timestamp < this.electionTimeout! && tabId !== this.tabId) {
            this.isLeaderFlag = false;
          }
          break;

        case 'leader':
          // Someone else became leader
          if (tabId !== this.tabId) {
            this.isLeaderFlag = false;
            this.onLeaderChange?.(false);
          }
          break;

        case 'heartbeat':
          // Leader is still alive
          if (tabId !== this.tabId) {
            this.isLeaderFlag = false;
          }
          break;
      }
    };
  }

  async electLeader(): Promise<boolean> {
    return new Promise((resolve) => {
      this.electionTimeout = Date.now();

      // Request election
      this.channel.postMessage({
        type: 'election',
        tabId: this.tabId,
        timestamp: this.electionTimeout,
      });

      // Wait for responses
      setTimeout(() => {
        // If we still think we're leader after responses, we are
        if (this.electionTimeout) {
          this.isLeaderFlag = true;
          this.channel.postMessage({
            type: 'leader',
            tabId: this.tabId,
          });
          this.startHeartbeat();
          this.onLeaderChange?.(true);
        }
        resolve(this.isLeaderFlag);
      }, 100);
    });
  }

  isLeader(): boolean {
    return this.isLeaderFlag;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      if (this.isLeaderFlag) {
        this.channel.postMessage({
          type: 'heartbeat',
          tabId: this.tabId,
        });
      }
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  onLeadershipChange(callback: (isLeader: boolean) => void) {
    this.onLeaderChange = callback;
  }

  resign() {
    this.isLeaderFlag = false;
    this.stopHeartbeat();
    this.onLeaderChange?.(false);
  }

  destroy() {
    this.resign();
    this.channel.close();
  }
}
