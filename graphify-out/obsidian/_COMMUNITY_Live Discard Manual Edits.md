---
type: community
cohesion: 0.21
members: 20
---

# Live Discard Manual Edits

**Cohesion:** 0.21 - loosely connected
**Members:** 20 nodes

## Members
- [[argVal()_2]] - code - .agents/skills/impeccable/scripts/live-discard-manual-edits.mjs
- [[args]] - code - .agents/skills/impeccable/scripts/live-discard-manual-edits.mjs
- [[buffer]] - code - .agents/skills/impeccable/scripts/live-discard-manual-edits.mjs
- [[buildManualEditEvidence()]] - code - .agents/skills/impeccable/scripts/live-manual-edit-evidence.mjs
- [[countByPage()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[createRequestHandler()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[cwd]] - code - .agents/skills/impeccable/scripts/live-discard-manual-edits.mjs
- [[getBufferPath()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[live-discard-manual-edits.mjs]] - code - .agents/skills/impeccable/scripts/live-discard-manual-edits.mjs
- [[live-manual-edits-buffer.mjs]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[pageUrlFilter]] - code - .agents/skills/impeccable/scripts/live-discard-manual-edits.mjs
- [[readBuffer()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[readBufferInternal()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[readBufferStrict()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[remaining]] - code - .agents/skills/impeccable/scripts/live-discard-manual-edits.mjs
- [[removeEntries()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[stageEntry()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[summarizePendingManualEditBatch()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[truncateBuffer()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs
- [[writeBuffer()]] - code - .agents/skills/impeccable/scripts/live-manual-edits-buffer.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Discard_Manual_Edits
SORT file.name ASC
```

## Connections to other communities
- 13 edges to [[_COMMUNITY_Live Manual Edit Commit]]
- 10 edges to [[_COMMUNITY_Live Server Core]]
- 7 edges to [[_COMMUNITY_Manual Edit Evidence Analysis]]
- 5 edges to [[_COMMUNITY_Impeccable Path Utils]]
- 5 edges to [[_COMMUNITY_Live Accept Module]]
- 2 edges to [[_COMMUNITY_Generated File Detection]]
- 1 edge to [[_COMMUNITY_Design Parser]]
- 1 edge to [[_COMMUNITY_Live Event Validation]]
- 1 edge to [[_COMMUNITY_Live Server Broadcast]]

## Top bridge nodes
- [[live-manual-edits-buffer.mjs]] - degree 17, connects to 6 communities
- [[readBuffer()]] - degree 17, connects to 6 communities
- [[createRequestHandler()]] - degree 12, connects to 5 communities
- [[buildManualEditEvidence()]] - degree 10, connects to 3 communities
- [[writeBuffer()]] - degree 9, connects to 2 communities