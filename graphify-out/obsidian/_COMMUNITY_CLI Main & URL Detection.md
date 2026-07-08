---
type: community
cohesion: 0.20
members: 24
---

# CLI Main & URL Detection

**Cohesion:** 0.20 - loosely connected
**Members:** 24 nodes

## Members
- [[ANTIPATTERNS]] - code - .agents/skills/impeccable/scripts/detector/registry/antipatterns.mjs
- [[FRAMEWORK_CONFIGS]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[GATED_PROVIDERS]] - code - .agents/skills/impeccable/scripts/detector/registry/antipatterns.mjs
- [[HTML_EXTENSIONS]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[RULE_ENGINE_SUPPORT]] - code - .agents/skills/impeccable/scripts/detector/registry/antipatterns.mjs
- [[SCANNABLE_EXTENSIONS]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[SKIP_DIRS_1]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[antipatterns.mjs]] - code - .agents/skills/impeccable/scripts/detector/registry/antipatterns.mjs
- [[buildImportGraph()]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[confirm()]] - code - .agents/skills/impeccable/scripts/detector/cli/main.mjs
- [[createBrowserDetector()]] - code - .agents/skills/impeccable/scripts/detector/engines/browser/detect-url.mjs
- [[detect-antipatterns.mjs]] - code - .agents/skills/impeccable/scripts/detector/detect-antipatterns.mjs
- [[detectCli()]] - code - .agents/skills/impeccable/scripts/detector/cli/main.mjs
- [[detectFrameworkConfig()]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[file-system.mjs]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[formatFindings()]] - code - .agents/skills/impeccable/scripts/detector/cli/main.mjs
- [[getRuleEngineSupport()]] - code - .agents/skills/impeccable/scripts/detector/registry/antipatterns.mjs
- [[getRulesForCategory()]] - code - .agents/skills/impeccable/scripts/detector/registry/antipatterns.mjs
- [[handleStdin()]] - code - .agents/skills/impeccable/scripts/detector/cli/main.mjs
- [[isPortListening()]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[main.mjs]] - code - .agents/skills/impeccable/scripts/detector/cli/main.mjs
- [[printUsage()]] - code - .agents/skills/impeccable/scripts/detector/cli/main.mjs
- [[resolveImport()]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs
- [[walkDir()]] - code - .agents/skills/impeccable/scripts/detector/node/file-system.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/CLI_Main__URL_Detection
SORT file.name ASC
```

## Connections to other communities
- 34 edges to [[_COMMUNITY_Browser URL Detector]]
- 14 edges to [[_COMMUNITY_CSS Rule Checks]]
- 6 edges to [[_COMMUNITY_CSS Typography Rules]]
- 2 edges to [[_COMMUNITY_Live Browser Clipboard & State]]
- 1 edge to [[_COMMUNITY_Live Browser DOM Editing]]

## Top bridge nodes
- [[detect-antipatterns.mjs]] - degree 54, connects to 3 communities
- [[confirm()]] - degree 5, connects to 2 communities
- [[main.mjs]] - degree 19, connects to 1 community
- [[detectCli()]] - degree 14, connects to 1 community
- [[antipatterns.mjs]] - degree 12, connects to 1 community