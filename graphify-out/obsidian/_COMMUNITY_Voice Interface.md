---
type: community
cohesion: 0.25
members: 11
---

# Voice Interface

**Cohesion:** 0.25 - loosely connected
**Members:** 11 nodes

## Members
- [[configureVoiceContext()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[isEmbeddedPreviewBrowser()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[releaseVoiceEngine()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[startVoice()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[steerSpeechRecognitionCtor()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[steerVoiceContext()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[steerVoiceErrorMessage()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[steerVoiceUnavailableMessage()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[stopVoice()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[toggleConfigureVoice()]] - code - .agents/skills/impeccable/scripts/live-browser.js
- [[toggleSteerVoice()]] - code - .agents/skills/impeccable/scripts/live-browser.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Voice_Interface
SORT file.name ASC
```

## Connections to other communities
- 12 edges to [[_COMMUNITY_Live Browser Core]]
- 3 edges to [[_COMMUNITY_Live Browser Focus & Steer]]
- 2 edges to [[_COMMUNITY_Live Browser Session Management]]
- 2 edges to [[_COMMUNITY_Live Browser Clipboard & State]]
- 1 edge to [[_COMMUNITY_Live Browser UI Components]]
- 1 edge to [[_COMMUNITY_Editing State Machine]]

## Top bridge nodes
- [[stopVoice()]] - degree 13, connects to 5 communities
- [[startVoice()]] - degree 9, connects to 2 communities
- [[configureVoiceContext()]] - degree 3, connects to 2 communities
- [[toggleConfigureVoice()]] - degree 4, connects to 1 community
- [[toggleSteerVoice()]] - degree 4, connects to 1 community