---
type: community
cohesion: 0.18
members: 24
---

# Live Completion & Poll

**Cohesion:** 0.18 - loosely connected
**Members:** 24 nodes

## Members
- [[EVENT_TYPES_NEEDING_AGENT_REPLY]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[augmentEventWithAcceptHandling()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[buildAcceptScriptArgs()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[buildPollReplyPayload()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[completionAckForAcceptResult()]] - code - .agents/skills/impeccable/scripts/live-completion.mjs
- [[completionTypeForAcceptResult()]] - code - .agents/skills/impeccable/scripts/live-completion.mjs
- [[fetchNextEvent()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[fetchServerStatus()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[handlePollError()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[isEventPending()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[live-completion.mjs]] - code - .agents/skills/impeccable/scripts/live-completion.mjs
- [[live-poll.mjs]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[manualApplyPollBanner()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[parseReplyArgs()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[pollCli()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[postReply()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[printPollEvent()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[readServerInfo()_1]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[requiresAgentReply()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[runPollOnce()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[runPollStream()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[validateReplyArgs()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[waitForEventAck()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs
- [[writeCarbonizeBanner()]] - code - .agents/skills/impeccable/scripts/live-poll.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Completion__Poll
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Impeccable Paths & Live Complete]]
- 1 edge to [[_COMMUNITY_Impeccable Path Utils]]

## Top bridge nodes
- [[live-poll.mjs]] - degree 25, connects to 2 communities
- [[readServerInfo()_1]] - degree 3, connects to 1 community