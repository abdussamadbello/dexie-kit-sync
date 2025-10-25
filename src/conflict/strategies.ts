import type { ConflictInfo, ConflictPolicy } from '../core/types';

/**
 * Server-wins: Always use the server version
 */
export function serverWins(conflict: ConflictInfo): any {
  return conflict.remote;
}

/**
 * Client-wins: Always use the client version
 */
export function clientWins(conflict: ConflictInfo): any {
  return conflict.local;
}

/**
 * Last-write-wins: Use the most recently updated version
 */
export function lastWriteWins(conflict: ConflictInfo): any {
  const localTime = conflict.localTimestamp || 0;
  const remoteTime = conflict.remoteTimestamp || 0;

  if (localTime > remoteTime) {
    return conflict.local;
  } else if (remoteTime > localTime) {
    return conflict.remote;
  }

  // If timestamps are equal, prefer server
  return conflict.remote;
}

/**
 * Get the built-in conflict resolution strategy
 */
export function getStrategy(policy: ConflictPolicy): (conflict: ConflictInfo) => any {
  switch (policy) {
    case 'server-wins':
      return serverWins;
    case 'client-wins':
      return clientWins;
    case 'lww':
      return lastWriteWins;
    default:
      return serverWins;
  }
}
