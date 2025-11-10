# PR Gutter

A VS Code extension that shows git diff highlighting in the gutter between the current branch and a configurable target branch (defaults to `main`).

## Features

- **Gutter Diff Highlighting**: Shows visual indicators in the editor gutter for lines that have been added, modified, or deleted compared to the target branch
- **Configurable Target Branch**: Set any branch as the comparison target (defaults to `main`)
- **Auto-refresh**: Automatically updates diff highlights when files are saved (configurable)
- **Visual Indicators**:

  - 🟢 Green plus icon for added lines
  - 🟠 Orange bar for modified lines
  - 🔴 Red bar for deleted lines

## Usage

### Quick Start

1. Install the extension
2. Open a git repository in VS Code
3. The extension will automatically show diff highlights comparing your current branch to `main`

### Commands

- **PR Gutter: Set Target Branch** - Choose which branch to compare against
- **PR Gutter: Refresh Diff** - Manually refresh the diff highlighting

### Configuration

You can configure the extension through VS Code settings:

```json
{
  "pr-gutter.targetBranch": "main",        // Branch to compare against
  "pr-gutter.autoRefresh": true            // Auto-refresh on file changes
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

These changes are then highlighted in the VS Code gutter with colored indicators and background highlighting.

## Development

To contribute to this extension:

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to compile TypeScript
4. Press `F5` in VS Code to launch a new Extension Development Host window

## Requirements

- VS Code 1.74.0 or higher
- Git repository

## License

MIT
