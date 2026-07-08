---
type: community
cohesion: 0.16
members: 28
---

# Live Browser Clipboard & State

**Cohesion:** 0.16 - loosely connected
**Members:** 28 nodes

## Members
- [[clearStoredManualApplyState()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[copyToClipboard()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[fetchPendingCount()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[handleManualEditActivity()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[hidePendingApplyDock()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[manualApplyLoadingText()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[manualApplyStateKey()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[manualEditEventForCurrentPage()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[maybeWarnConditionalAncestor()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[numberOrNull()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[onPendingKeepFixingClick()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[onPendingPillClick()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[onPendingRollbackClick()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[pendingApplyLabel()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[playPendingIntroAnimation()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[readStoredManualApplyState()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[remainingManualEditCount()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[resetManualApplyProgress()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[schedulePendingDockPosition()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[setPendingApplyLoading()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[shouldResumeManualApplyLoading()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[showManualApplyDecision()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[showToast()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[storeManualApplyState()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[updateManualApplyProgressFromChunk()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[updateManualApplyRepairState()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[updatePendingCounter()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[writeManualApplyState()]] - code - .agents/skills/impeccable/scripts/live-browser.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Browser_Clipboard__State
SORT file.name ASC
```

## Connections to other communities
- 29 edges to [[_COMMUNITY_Live Browser Core]]
- 6 edges to [[_COMMUNITY_Editing State Machine]]
- 5 edges to [[_COMMUNITY_Live Browser DOM Editing]]
- 4 edges to [[_COMMUNITY_Live Browser UI Components]]
- 3 edges to [[_COMMUNITY_Live Browser Session Management]]
- 2 edges to [[_COMMUNITY_CLI Main & URL Detection]]
- 2 edges to [[_COMMUNITY_Voice Interface]]
- 1 edge to [[_COMMUNITY_Live Browser Focus & Steer]]

## Top bridge nodes
- [[showToast()]] - degree 22, connects to 7 communities
- [[updatePendingCounter()]] - degree 13, connects to 2 communities
- [[setPendingApplyLoading()]] - degree 12, connects to 2 communities
- [[onPendingPillClick()]] - degree 8, connects to 2 communities
- [[showManualApplyDecision()]] - degree 7, connects to 2 communities