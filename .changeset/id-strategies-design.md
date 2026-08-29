---
"@dexie-kit/sync": patch
---

Document and support client-generated ids as the recommended primary-key strategy, replacing the previous unremediated limitation around server-assigned ids:

- `startSync()` now warns (via `console.warn`) when a synced table still uses a Dexie auto-incrementing key, pointing at the new "ID Strategies" section of the README.
- The `deleting` hook now captures the full record (not just its key), so a route addressing the server by a separate `serverId`-style field (Pattern 2 in the docs) can also do so on delete — previously only create/update had this.
- A record created and then deleted before it's ever pushed is now dropped from the outbox entirely instead of being synced — the server never knew it existed, so there's nothing to reconcile.
- README and `examples/basic-usage.md` now lead with client-generated ids (`crypto.randomUUID()`, no `++id`) and document both the recommended pattern (client id is canonical everywhere) and a fallback pattern for backends that must keep their own id scheme.
