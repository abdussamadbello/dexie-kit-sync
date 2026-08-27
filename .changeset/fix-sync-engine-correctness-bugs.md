---
"@dexie-kit/sync": patch
---

Fix several correctness bugs in the sync engine:

- Change tracking never actually recorded anything: the `creating`/`updating`/`deleting` hooks wrote to the `outbox` table from inside the mutation's own IndexedDB transaction, which is scoped only to the table being written — every write threw `NotFoundError` internally and was silently swallowed. All local changes are now tracked correctly.
- Pushing a `delete` crashed when the route's `url`/`body` callback read `item.id` (as shown in the README), since deletes never carried a payload object.
- Auto-incrementing creates were tracked with an `undefined` key, since Dexie only exposes the generated primary key via the `creating` hook's `onsuccess` callback.
- Outbox items could be pushed out of order and concurrently for the same record (e.g. an `update` racing ahead of its `create`). Pushes are now grouped per record and processed in order; different records still push concurrently.
- Leader election could be stolen by a newly-opened tab, could end up with two tabs believing they were leader at once, and never re-elected a leader after the leader tab closed or crashed. It's now safe against all three, and no longer throws when `BroadcastChannel` is unavailable (SSR).
- A `Retry-After` header in HTTP-date form (vs. delay-seconds) parsed as `NaN` and retried almost immediately instead of honoring the server's requested backoff.
- `rateLimit` on a push route and `pauseTable`/`resumeTable` were accepted but silently had no effect. `observability` metrics for network bytes/latency, error counts, and dead-letter counts were never recorded. All four now work.
- The server's response to a push is merged back onto the local record (e.g. a server-computed `version`/`updatedAt`), rather than discarded.
