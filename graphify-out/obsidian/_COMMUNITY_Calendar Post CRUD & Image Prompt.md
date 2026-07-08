---
type: community
cohesion: 0.18
members: 13
---

# Calendar Post CRUD & Image Prompt

**Cohesion:** 0.18 - loosely connected
**Members:** 13 nodes

## Members
- [[DELETE()_3]] - code - app/api/calendar-posts/[id]/route.js
- [[ImagePromptModal()]] - code - components/ImagePromptModal.jsx
- [[ImagePromptModal.jsx]] - code - components/ImagePromptModal.jsx
- [[PATCH()_1]] - code - app/api/calendar-posts/[id]/route.js
- [[PostSummary()]] - code - components/ImagePromptModal.jsx
- [[_parseInlineFieldsString()]] - code - lib/calendar-post-utils.js
- [[emptyNormalizedPost()]] - code - lib/calendar-post-utils.js
- [[formatOutputImageTextRequirementsForDisplay()]] - code - lib/calendar-post-utils.js
- [[normalisePost()]] - code - app/api/content-calendar/generate/route.js
- [[normalizeOutputImageTextRequirementsStructured()]] - code - lib/calendar-post-utils.js
- [[normalizePost()]] - code - lib/calendar-post-utils.js
- [[route.js_10]] - code - app/api/calendar-posts/[id]/route.js
- [[safeParseJson()_1]] - code - components/ImagePromptModal.jsx

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Calendar_Post_CRUD__Image_Prompt
SORT file.name ASC
```

## Connections to other communities
- 7 edges to [[_COMMUNITY_Calendar Post Utilities]]
- 2 edges to [[_COMMUNITY_Post Regeneration (Legacy)]]
- 2 edges to [[_COMMUNITY_Module Group 87]]
- 2 edges to [[_COMMUNITY_Module Group 95]]
- 2 edges to [[_COMMUNITY_Post Regeneration API]]
- 1 edge to [[_COMMUNITY_Content Calendar AI Generation]]
- 1 edge to [[_COMMUNITY_Export & Google Drive API]]

## Top bridge nodes
- [[normalizeOutputImageTextRequirementsStructured()]] - degree 12, connects to 5 communities
- [[formatOutputImageTextRequirementsForDisplay()]] - degree 9, connects to 5 communities
- [[normalizePost()]] - degree 5, connects to 2 communities
- [[normalisePost()]] - degree 3, connects to 1 community
- [[emptyNormalizedPost()]] - degree 2, connects to 1 community