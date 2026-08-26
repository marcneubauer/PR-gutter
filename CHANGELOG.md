# Change Log

All notable changes to the "pr-gutter" extension will be documented in this file.

## [0.1.0] - 2026-08-26

### Fixed

- Changed lines are now correctly reported as **modified** (orange) - previously every change appeared as a delete + add pair, and the modified decorations were dead code
- Runs of consecutive deleted lines now produce a single deletion marker instead of stacking duplicates on one line

### Added

- Multi-root workspace support: each workspace folder resolves its own repository, default branch, and diff base
- All visible editors (splits) are decorated, not just the active one
- `pr-gutter.trace` setting for verbose diagnostics (default off - routine logging no longer spams the output channel and console)
- Status bar item showing the comparison target and the active file's change counts (`+added ~modified -deleted`); click it to pick a different target branch
- Live decoration updates while typing: unsaved buffer contents are diffed against the target (debounced; disable with `pr-gutter.liveUpdate`)
- Unit tests for the diff parser (vitest), run in CI

- Auto-detection of the repository default branch (origin/HEAD, falling back to main/master/develop/trunk) when `pr-gutter.targetBranch` is empty (now the default)
- "Auto-detect" option in the Set Target Branch quick pick
- "Pick Branch..." action on missing-target warnings
- CI workflow (compile + package `.vsix` on every push/PR) and release workflow (tag `v*` publishes a GitHub Release with the `.vsix`; publishes to the VS Code Marketplace when `VSCE_PAT` is configured)

### Performance

- The comparison target is resolved once to a cached merge-base (invalidated on branch switch, commit, fetch, or config change) instead of trying up to four diff strategies on every editor switch
- Decoration refreshes are debounced; bursts of saves or editor switches collapse into one update
- Saving a file only re-diffs when it is the active document; `git status`/`git branch` are no longer run on every save

### Changed

- Outline colors now follow the active color theme (`editorGutter.addedBackground` / `editorGutter.modifiedBackground`) instead of hardcoded RGB values, and all changes are marked in the overview ruler
- Diffs now compare the working tree against the merge-base with the target, so uncommitted changes are highlighted too (previously only committed changes were shown); on the target branch itself, uncommitted changes are shown instead of nothing
- Missing target branch/commit warnings now appear at most once per target instead of on every save, and no longer dump the full branch list
- Detached HEAD no longer triggers warning popups on every save (logged once to the output channel instead)
- `pr-gutter.showStartupNotification` now defaults to `false` - the status bar item indicates activation instead
- Extension activates via `workspaceContains:.git` instead of on every startup
- All listeners, watchers, decoration types, and channels are now properly registered as disposables (no more leaks); the debug command reuses one output channel instead of creating a new one per invocation
- Non-file documents are skipped by URI scheme instead of path prefix
- `npm run reinstall` no longer hardcodes a personal absolute path
- README documents real installation steps (GitHub Release `.vsix` or build from source)

### Removed

- The `simple-git` dependency - git is now invoked directly through a thin `GitCli` wrapper (`src/gitCli.ts`), leaving the extension with zero runtime dependencies and a smaller bundle
- Committed build artifacts (`dist/`, `out/`, `*.vsix`) removed from the repository and gitignored

## [0.0.1] - 2025-11-09

### Added

- Initial release of PR Gutter extension
- Git diff highlighting in editor gutter comparing current branch vs configurable target branch
- Support for added, modified, and deleted line indicators
- Configurable target branch (defaults to 'main')
- Auto-refresh functionality when files are saved
- Commands to set target branch and manually refresh diff
- Hover tooltips showing change information
- Visual gutter icons for different change types
- Intelligent diff parsing with consecutive line merging
- Fallback strategies for branch comparison (remote/local/direct)
- Proper handling of edge cases (empty diffs, invalid branches, etc.)

### Features

- **Gutter Icons**: Green plus for added lines, orange bar for modified, red bar for deleted
- **Branch Selection**: Quick pick menu to choose target branch from available branches
- **Auto-detection**: Automatically works when opening files in git repositories
- **Error Handling**: Graceful handling of missing branches and git errors
