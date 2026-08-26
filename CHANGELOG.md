# Change Log

All notable changes to the "pr-gutter" extension will be documented in this file.

## [Unreleased]

### Fixed

- Changed lines are now correctly reported as **modified** (orange) - previously every change appeared as a delete + add pair, and the modified decorations were dead code
- Runs of consecutive deleted lines now produce a single deletion marker instead of stacking duplicates on one line

### Added

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
- `npm run reinstall` no longer hardcodes a personal absolute path
- README documents real installation steps (GitHub Release `.vsix` or build from source)

### Removed

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
