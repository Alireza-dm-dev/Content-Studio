---
type: community
cohesion: 0.25
members: 9
---

# Browser Findings Overlay

**Cohesion:** 0.25 - loosely connected
**Members:** 9 nodes

## Members
- [[addBrowserFindings()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[addVisualContrastFindings()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[addVisualContrastResult()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[clearOverlays()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[detachOverlay()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[disconnectLazyVisualContrastObserver()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[scheduleLazyVisualContrast()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[shouldRunVisualContrast()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- [[visualContrastOptions()_1]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Browser_Findings_Overlay
SORT file.name ASC
```

## Connections to other communities
- 9 edges to [[_COMMUNITY_Browser Anti-Pattern Detection]]
- 2 edges to [[_COMMUNITY_Color Anti-Pattern Checks]]
- 1 edge to [[_COMMUNITY_Visual Contrast Analysis]]

## Top bridge nodes
- [[addVisualContrastFindings()_1]] - degree 8, connects to 3 communities
- [[addBrowserFindings()_1]] - degree 3, connects to 2 communities
- [[disconnectLazyVisualContrastObserver()_1]] - degree 4, connects to 1 community
- [[addVisualContrastResult()_1]] - degree 3, connects to 1 community
- [[clearOverlays()_1]] - degree 3, connects to 1 community