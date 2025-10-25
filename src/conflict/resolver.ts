import type { ConflictInfo, ConflictConfig, SyncContext } from '../core/types';
import { getStrategy } from './strategies';

export class ConflictResolver {
  constructor(
    private config: ConflictConfig,
    private context: SyncContext
  ) {}

  async resolve(conflict: ConflictInfo): Promise<any> {
    // Emit conflict event
    this.context.emit('conflict', conflict);

    // Use custom resolver if provided
    if (this.config.policy === 'custom' && this.config.onConflict) {
      return await this.config.onConflict(conflict);
    }

    // Use built-in strategy
    const strategy = getStrategy(this.config.policy);
    return strategy(conflict);
  }

  /**
   * Detect if there's a conflict between local and remote versions
   */
  detectConflict(local: any, remote: any): boolean {
    // No local version means no conflict
    if (!local) {
      return false;
    }

    // Check version numbers if available
    if (local.version !== undefined && remote.version !== undefined) {
      return local.version !== remote.version;
    }

    // Check timestamps if available
    if (local.updatedAt && remote.updatedAt) {
      const localTime = new Date(local.updatedAt).getTime();
      const remoteTime = new Date(remote.updatedAt).getTime();
      return localTime !== remoteTime;
    }

    // Assume conflict if we can't determine
    return true;
  }
}
