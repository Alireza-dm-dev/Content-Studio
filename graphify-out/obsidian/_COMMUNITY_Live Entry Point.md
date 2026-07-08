---
type: community
cohesion: 0.42
members: 9
---

# Live Entry Point

**Cohesion:** 0.42 - moderately connected
**Members:** 9 nodes

## Members
- [[__dirname_3]] - code - .agents/skills/impeccable/scripts/live.mjs
- [[ensureServerRunning()]] - code - .agents/skills/impeccable/scripts/live.mjs
- [[globToRegex()_1]] - code - .agents/skills/impeccable/scripts/live.mjs
- [[live.mjs]] - code - .agents/skills/impeccable/scripts/live.mjs
- [[liveCli()]] - code - .agents/skills/impeccable/scripts/live.mjs
- [[resolveFiles()]] - code - .agents/skills/impeccable/scripts/live-inject.mjs
- [[runScript()]] - code - .agents/skills/impeccable/scripts/live.mjs
- [[safeParse()]] - code - .agents/skills/impeccable/scripts/live.mjs
- [[scanForDrift()]] - code - .agents/skills/impeccable/scripts/live.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Entry_Point
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Context Builder]]
- 3 edges to [[_COMMUNITY_Live Inject Module]]
- 2 edges to [[_COMMUNITY_Impeccable Paths & Live Complete]]
- 1 edge to [[_COMMUNITY_CSP Detection]]
- 1 edge to [[_COMMUNITY_Impeccable Path Utils]]

## Top bridge nodes
- [[live.mjs]] - degree 13, connects to 4 communities
- [[liveCli()]] - degree 7, connects to 1 community
- [[ensureServerRunning()]] - degree 5, connects to 1 community
- [[resolveFiles()]] - degree 4, connects to 1 community
- [[scanForDrift()]] - degree 3, connects to 1 community