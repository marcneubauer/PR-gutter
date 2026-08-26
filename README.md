# PR Gutter

A VS Code extension that shows git diff highlighting in the gutter between the current branch and a configurable target branch (defaults to `main`).

## Features

- **Gutter Diff Highlighting**: Shows visual indicators in the editor gutter for lines that have been added, modified, or deleted compared to the target branch
- **Configurable Target Branch**: Set any branch (or a specific commit) as the comparison target
- **Auto-refresh**: Automatically updates diff highlights when files are saved (configurable)
- **Visual Indicators**:

  - 😂 gutter emoji + green outline for added lines
  - ❓ gutter emoji + orange outline for modified lines
  - 🥓 gutter emoji for deleted lines

## Installation

### From a GitHub Release (recommended)

1. Download the latest `pr-gutter-<version>.vsix` from the [Releases page](https://github.com/marcneubauer/PR-gutter/releases)
2. Install it, either:
   - From the terminal: `code --install-extension pr-gutter-<version>.vsix`
   - Or in VS Code: Extensions view → `···` menu → **Install from VSIX...**
3. Reload VS Code when prompted

### From source

```bash
git clone https://github.com/marcneubauer/PR-gutter.git
cd PR-gutter
npm install
npm run reinstall   # builds the .vsix and (re)installs it into VS Code
```

> `npm run reinstall` packages the extension, uninstalls any previous version, and installs the freshly built `.vsix`.

## Usage

### Quick Start

1. Install the extension (see above)
2. Open a git repository in VS Code
3. The extension will automatically show diff highlights comparing your current branch to `main`

### Commands

- **PR Gutter: Set Target Branch** - Choose which branch to compare against
- **PR Gutter: Refresh Diff** - Manually refresh the diff highlighting
- **PR Gutter: Show Debug Info** - Dump diagnostic info to an output channel

### Configuration

You can configure the extension through VS Code settings:

```json
{
  "pr-gutter.targetBranch": "main",        // Branch to compare against
  "pr-gutter.targetCommit": "",            // Commit hash (takes precedence over targetBranch)
  "pr-gutter.autoRefresh": true,           // Auto-refresh on file changes
  "pr-gutter.showOutline": true,           // Border outline around changed lines
  "pr-gutter.showGutterIcons": true,       // Emoji icons in the gutter
  "pr-gutter.showStartupNotification": true // Notification on activation
}
```

### Setting Target Branch

1. Open the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)
2. Run "PR Gutter: Set Target Branch"
3. Select the branch you want to compare against from the list

## How It Works

The extension uses `git diff` to compare the current branch with the target branch and parses the diff output to identify:

- **Added lines**: New lines that don't exist in the target branch
- **Modified lines**: Lines that have been changed from the target branch
- **Deleted lines**: Lines that exist in the target branch but not in the current branch

These changes are then highlighted in the VS Code gutter with emoji indicators and outlines.

## Development

To contribute to this extension:

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to compile TypeScript
4. Press `F5` in VS Code to launch a new Extension Development Host window

## Releasing

Pushing a tag matching `v*` (e.g. `v0.0.2`) triggers the release workflow, which builds the `.vsix`, attaches it to a GitHub Release, and — if a `VSCE_PAT` repository secret is configured — publishes to the VS Code Marketplace.

```bash
git tag v0.0.2 && git push origin v0.0.2
```

## Requirements

- VS Code 1.74.0 or higher
- Git repository

## License

MIT
