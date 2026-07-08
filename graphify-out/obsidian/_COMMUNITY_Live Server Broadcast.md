---
type: community
cohesion: 0.28
members: 9
---

# Live Server Broadcast

**Cohesion:** 0.28 - loosely connected
**Members:** 9 nodes

## Members
- [[broadcast()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[clearManualApplyTransaction()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[manualApplyTransactionPath()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[normalizeProjectFile()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[readManualApplyTransaction()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[recordManualEditActivity()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[rollbackManualApplyTransaction()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[summarizeManualDiagnostics()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[writeManualApplyTransaction()]] - code - .agents/skills/impeccable/scripts/live-server.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Server_Broadcast
SORT file.name ASC
```

## Connections to other communities
- 11 edges to [[_COMMUNITY_Live Server Core]]
- 2 edges to [[_COMMUNITY_Impeccable Path Utils]]
- 1 edge to [[_COMMUNITY_Live Discard Manual Edits]]
- 1 edge to [[_COMMUNITY_Live Server Event Management]]

## Top bridge nodes
- [[rollbackManualApplyTransaction()]] - degree 7, connects to 2 communities
- [[manualApplyTransactionPath()]] - degree 5, connects to 2 communities
- [[recordManualEditActivity()]] - degree 5, connects to 2 communities
- [[broadcast()]] - degree 3, connects to 2 communities
- [[clearManualApplyTransaction()]] - degree 4, connects to 1 community