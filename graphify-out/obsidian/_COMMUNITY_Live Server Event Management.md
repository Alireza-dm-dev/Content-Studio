---
type: community
cohesion: 0.31
members: 11
---

# Live Server Event Management

**Cohesion:** 0.31 - loosely connected
**Members:** 11 nodes

## Members
- [[acknowledgePendingEvent()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[agentPollingConnected()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[broadcastAgentPollingIfChanged()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[cancelQueuedAnonymousExitEvents()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[enqueueEvent()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[findAvailablePendingEvent()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[flushPendingPolls()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[handlePollGet()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[leaseEvent()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[restorePendingEventsFromStore()]] - code - .agents/skills/impeccable/scripts/live-server.mjs
- [[scheduleLeaseFlush()]] - code - .agents/skills/impeccable/scripts/live-server.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Server_Event_Management
SORT file.name ASC
```

## Connections to other communities
- 12 edges to [[_COMMUNITY_Live Server Core]]
- 1 edge to [[_COMMUNITY_Live Server Broadcast]]

## Top bridge nodes
- [[broadcastAgentPollingIfChanged()]] - degree 8, connects to 2 communities
- [[flushPendingPolls()]] - degree 7, connects to 1 community
- [[scheduleLeaseFlush()]] - degree 6, connects to 1 community
- [[handlePollGet()]] - degree 5, connects to 1 community
- [[leaseEvent()]] - degree 5, connects to 1 community