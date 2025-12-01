# Change Log

All notable changes to the "pr-gutter" extension will be documented in this file.


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
- **Performance**: Only updates decorations for active editor to minimize resource usage
