---
type: community
cohesion: 0.09
members: 50
---

# Live Manual Edit Commit

**Cohesion:** 0.09 - loosely connected
**Members:** 50 nodes

## Members
- [[ROLLBACK_EXTENSIONS]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[ROLLBACK_SKIP_DIRS]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[allEntryIds()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[argVal()_1]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[buildRepairBatch()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[candidatesForEntry()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[changedFilesSinceSnapshot()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[clearAppliedEntries()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[collectApplyOwnedFiles()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[collectRollbackFiles()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[commitManualEdits()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[countOps()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[coupledObjectKeyFailuresForOp()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[escapeRegExp()_2]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[findUnappliedEntrySourceChanges()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[lineHasObjectKey()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[lineMatchesManualEditLocator()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[lineShowsAppliedOp()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[live-commit-manual-edits.mjs]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[locatorTargetsInFile()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[main()_1]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[mergeFailedEntries()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[mergeUniqueStrings()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[normalizeFailedEntries()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[normalizeProjectSourcePath()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[normalizeRelativeFile()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[normalizeRollbackPath()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[normalizeVerificationText()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[objectKeyCandidatesForOp()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[objectKeyMatchStillUsesOriginal()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[opHasLocator()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[repairAttemptLimit()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[repairPostApplyValidation()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[rollbackChangedFiles()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[scanRollbackDir()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[siblingCandidatesForEntry()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[snapshotRollbackFiles()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[snapshotTargetPasses()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[sourceHintWindowFailure()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[summarizeAppliedEntries()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[summarizeRepairFailures()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[uniqueStrings()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[unreportedChangedFiles()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[verificationFailuresForEntries()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[verificationTargetPasses()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[verificationTargetPassesLines()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[verificationTargetsForOp()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[verifyAppliedEntry()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[verifyEntriesAfterRepair()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs
- [[windowShowsAppliedOp()]] - code - .agents/skills/impeccable/scripts/live-commit-manual-edits.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Manual_Edit_Commit
SORT file.name ASC
```

## Connections to other communities
- 13 edges to [[_COMMUNITY_Live Discard Manual Edits]]
- 7 edges to [[_COMMUNITY_Copy Edit Agent]]
- 4 edges to [[_COMMUNITY_Generated File Detection]]
- 2 edges to [[_COMMUNITY_Live Server Core]]
- 1 edge to [[_COMMUNITY_Manual Edit Evidence Analysis]]

## Top bridge nodes
- [[live-commit-manual-edits.mjs]] - degree 62, connects to 5 communities
- [[commitManualEdits()]] - degree 24, connects to 3 communities
- [[repairPostApplyValidation()]] - degree 15, connects to 2 communities
- [[clearAppliedEntries()]] - degree 5, connects to 1 community
- [[normalizeProjectSourcePath()]] - degree 4, connects to 1 community