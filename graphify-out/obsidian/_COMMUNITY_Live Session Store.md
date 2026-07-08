---
type: community
cohesion: 0.26
members: 12
---

# Live Session Store

**Cohesion:** 0.26 - loosely connected
**Members:** 12 nodes

## Members
- [[COMPLETED_PHASES]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[applyEvent()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[baseSnapshot()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[getJournalPath()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[getSnapshotPath()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[live-session-store.mjs]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[normalizeEvent()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[rebuildSnapshotFromJournal()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[safeSessionId()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[toPendingEvent()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[upsertArtifact()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[writeSnapshot()_1]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Session_Store
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Impeccable Paths & Live Complete]]
- 2 edges to [[_COMMUNITY_Impeccable Path Utils]]
- 1 edge to [[_COMMUNITY_Live Server Core]]

## Top bridge nodes
- [[live-session-store.mjs]] - degree 19, connects to 3 communities