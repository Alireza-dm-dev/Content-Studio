---
type: community
cohesion: 0.19
members: 21
---

# Impeccable Paths & Live Complete

**Cohesion:** 0.19 - loosely connected
**Members:** 21 nodes

## Members
- [[collectManualApplyFiles()]] - code - .agents/skills/impeccable/scripts/live-resume.mjs
- [[completeCli()]] - code - .agents/skills/impeccable/scripts/live-complete.mjs
- [[completeThroughServer()]] - code - .agents/skills/impeccable/scripts/live-complete.mjs
- [[createLiveSessionStore()]] - code - .agents/skills/impeccable/scripts/live-session-store.mjs
- [[fetchServerStatus()_1]] - code - .agents/skills/impeccable/scripts/live-status.mjs
- [[findPendingManualApply()]] - code - .agents/skills/impeccable/scripts/live-status.mjs
- [[getLegacyLiveSessionsDir()]] - code - .agents/skills/impeccable/scripts/impeccable-paths.mjs
- [[isLiveServerPidReachable()]] - code - .agents/skills/impeccable/scripts/impeccable-paths.mjs
- [[live-complete.mjs]] - code - .agents/skills/impeccable/scripts/live-complete.mjs
- [[live-resume.mjs]] - code - .agents/skills/impeccable/scripts/live-resume.mjs
- [[live-status.mjs]] - code - .agents/skills/impeccable/scripts/live-status.mjs
- [[manualApplyReplyCommand()]] - code - .agents/skills/impeccable/scripts/live-resume.mjs
- [[manualApplyResumeHint()]] - code - .agents/skills/impeccable/scripts/live-resume.mjs
- [[parseArgs()]] - code - .agents/skills/impeccable/scripts/live-complete.mjs
- [[parseArgs()_1]] - code - .agents/skills/impeccable/scripts/live-resume.mjs
- [[readLiveServerInfo()]] - code - .agents/skills/impeccable/scripts/impeccable-paths.mjs
- [[readServerInfo()]] - code - .agents/skills/impeccable/scripts/live-complete.mjs
- [[readServerInfo()_2]] - code - .agents/skills/impeccable/scripts/live-status.mjs
- [[resumeCli()]] - code - .agents/skills/impeccable/scripts/live-resume.mjs
- [[statusCli()]] - code - .agents/skills/impeccable/scripts/live-status.mjs
- [[summarizeManualApplyEvent()]] - code - .agents/skills/impeccable/scripts/live-resume.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Impeccable_Paths__Live_Complete
SORT file.name ASC
```

## Connections to other communities
- 8 edges to [[_COMMUNITY_Impeccable Path Utils]]
- 5 edges to [[_COMMUNITY_Live Session Store]]
- 2 edges to [[_COMMUNITY_Live Entry Point]]
- 2 edges to [[_COMMUNITY_Live Completion & Poll]]
- 2 edges to [[_COMMUNITY_Live Server Core]]

## Top bridge nodes
- [[readLiveServerInfo()]] - degree 13, connects to 4 communities
- [[createLiveSessionStore()]] - degree 10, connects to 3 communities
- [[live-status.mjs]] - degree 10, connects to 2 communities
- [[live-complete.mjs]] - degree 8, connects to 2 communities
- [[getLegacyLiveSessionsDir()]] - degree 3, connects to 2 communities