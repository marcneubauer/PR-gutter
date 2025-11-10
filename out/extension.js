"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const simple_git_1 = require("simple-git");
const path = __importStar(require("path"));
function activate(context) {
    const gitDiffProvider = new GitDiffProvider(context);
    // Register commands
    const setTargetBranchCommand = vscode.commands.registerCommand('pr-gutter.setTargetBranch', async () => {
        await gitDiffProvider.setTargetBranch();
    });
    const refreshDiffCommand = vscode.commands.registerCommand('pr-gutter.refreshDiff', async () => {
        await gitDiffProvider.refreshDiff();
    });
    context.subscriptions.push(setTargetBranchCommand, refreshDiffCommand);
    // Initialize the provider
    gitDiffProvider.initialize();
}
function deactivate() { }
class GitDiffProvider {
    constructor(context) {
        this.context = context;
        this.targetBranch = 'main';
        // Create decoration types for different change types
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 165, 0, 0.2)', // Orange for modified
            gutterIconPath: context.asAbsolutePath('resources/modified.svg'),
            gutterIconSize: 'contain'
        });
        this.addedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(0, 255, 0, 0.1)', // Green for added
            gutterIconPath: context.asAbsolutePath('resources/added.svg'),
            gutterIconSize: 'contain'
        });
        this.deletedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 0, 0, 0.1)', // Red for deleted
            gutterIconPath: context.asAbsolutePath('resources/deleted.svg'),
            gutterIconSize: 'contain'
        });
    }
    async initialize() {
        // Get workspace root
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.git = (0, simple_git_1.simpleGit)(this.workspaceRoot);
            // Get target branch from configuration
            this.updateTargetBranch();
            // Listen to configuration changes
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('pr-gutter.targetBranch')) {
                    this.updateTargetBranch();
                    this.refreshDiff();
                }
            });
            // Listen to file changes
            const autoRefresh = vscode.workspace.getConfiguration('pr-gutter').get('autoRefresh', true);
            if (autoRefresh) {
                vscode.workspace.onDidSaveTextDocument(() => {
                    this.refreshDiff();
                });
                vscode.window.onDidChangeActiveTextEditor(() => {
                    this.updateDecorations();
                });
            }
            // Initial diff update
            await this.refreshDiff();
        }
    }
    updateTargetBranch() {
        this.targetBranch = vscode.workspace.getConfiguration('pr-gutter').get('targetBranch', 'main');
    }
    async setTargetBranch() {
        if (!this.git) {
            vscode.window.showErrorMessage('No git repository found');
            return;
        }
        try {
            // Get all branches
            const branches = await this.git.branch();
            const branchNames = branches.all.filter((branch) => !branch.startsWith('remotes/'));
            const selectedBranch = await vscode.window.showQuickPick(branchNames, {
                placeHolder: 'Select target branch to compare against'
            });
            if (selectedBranch) {
                await vscode.workspace.getConfiguration('pr-gutter').update('targetBranch', selectedBranch, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage(`Target branch set to: ${selectedBranch}`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error getting branches: ${error}`);
        }
    }
    async refreshDiff() {
        if (!this.git || !this.workspaceRoot) {
            return;
        }
        try {
            // Get current branch
            const status = await this.git.status();
            const currentBranch = status.current;
            if (!currentBranch) {
                vscode.window.showWarningMessage('Not on any git branch');
                return;
            }
            // Check if target branch exists locally or remotely
            const branches = await this.git.branch();
            const targetExists = branches.all.includes(this.targetBranch) ||
                branches.all.includes(`remotes/origin/${this.targetBranch}`);
            if (!targetExists) {
                vscode.window.showWarningMessage(`Target branch '${this.targetBranch}' not found. Available branches: ${branches.all.join(', ')}`);
                return;
            }
            // Don't compare if we're already on the target branch
            if (currentBranch === this.targetBranch) {
                // Clear all decorations
                this.clearDecorations();
                return;
            }
            // Update decorations for currently visible editors
            this.updateDecorations();
        }
        catch (error) {
            console.error('Error refreshing diff:', error);
            vscode.window.showErrorMessage(`Error refreshing diff: ${error}`);
        }
    }
    clearDecorations() {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            activeEditor.setDecorations(this.addedDecorationType, []);
            activeEditor.setDecorations(this.decorationType, []);
            activeEditor.setDecorations(this.deletedDecorationType, []);
        }
    }
    async updateDecorations() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || !this.git || !this.workspaceRoot) {
            return;
        }
        const filePath = activeEditor.document.fileName;
        // Skip non-file schemes (like git:, output:, etc.)
        if (!filePath.startsWith(this.workspaceRoot)) {
            return;
        }
        const relativePath = path.relative(this.workspaceRoot, filePath);
        try {
            // Try different diff strategies
            let diffResult = '';
            try {
                // First try: compare with remote branch if it exists
                diffResult = await this.git.diff([`origin/${this.targetBranch}...HEAD`, '--', relativePath]);
            }
            catch {
                try {
                    // Second try: compare with local branch
                    diffResult = await this.git.diff([`${this.targetBranch}...HEAD`, '--', relativePath]);
                }
                catch {
                    // Third try: compare with branch directly
                    diffResult = await this.git.diff([this.targetBranch, 'HEAD', '--', relativePath]);
                }
            }
            const changes = this.parseDiff(diffResult);
            // Apply decorations
            this.applyDecorations(activeEditor, changes);
        }
        catch (error) {
            console.error('Error getting diff for file:', relativePath, error);
            // Clear decorations on error
            this.clearDecorations();
        }
    }
    parseDiff(diffText) {
        const changes = [];
        if (!diffText.trim()) {
            return changes;
        }
        const lines = diffText.split('\n');
        let currentNewLine = 0;
        let inHunk = false;
        for (const line of lines) {
            if (line.startsWith('@@')) {
                // Parse hunk header: @@ -old_start,old_count +new_start,new_count @@
                const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
                if (match) {
                    currentNewLine = parseInt(match[1]) - 1; // VS Code uses 0-based line numbers
                    inHunk = true;
                }
                continue;
            }
            if (!inHunk) {
                continue;
            }
            if (line.startsWith('+') && !line.startsWith('+++')) {
                // Added line
                changes.push({
                    startLine: currentNewLine,
                    endLine: currentNewLine,
                    type: 'added'
                });
                currentNewLine++;
            }
            else if (line.startsWith('-') && !line.startsWith('---')) {
                // Deleted line (shown at current position)
                changes.push({
                    startLine: currentNewLine,
                    endLine: currentNewLine,
                    type: 'deleted'
                });
                // Don't increment currentNewLine for deleted lines in the new file
            }
            else if (line.startsWith(' ')) {
                // Context line - exists in both versions
                currentNewLine++;
            }
            else if (line.startsWith('\\')) {
                // "No newline at end of file" - ignore
                continue;
            }
        }
        // Merge consecutive changes of the same type for better visualization
        return this.mergeConsecutiveChanges(changes);
    }
    mergeConsecutiveChanges(changes) {
        if (changes.length === 0) {
            return changes;
        }
        const merged = [];
        let current = changes[0];
        for (let i = 1; i < changes.length; i++) {
            const next = changes[i];
            // Merge if same type and consecutive lines
            if (current.type === next.type && current.endLine + 1 === next.startLine) {
                current.endLine = next.endLine;
            }
            else {
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);
        return merged;
    }
    applyDecorations(editor, changes) {
        const addedDecorations = [];
        const modifiedDecorations = [];
        const deletedDecorations = [];
        for (const change of changes) {
            // Ensure line numbers are within document bounds
            const startLine = Math.max(0, Math.min(change.startLine, editor.document.lineCount - 1));
            const endLine = Math.max(0, Math.min(change.endLine, editor.document.lineCount - 1));
            if (startLine >= editor.document.lineCount) {
                continue;
            }
            const startChar = 0;
            const endChar = editor.document.lineAt(endLine).text.length;
            const range = new vscode.Range(startLine, startChar, endLine, endChar);
            const decoration = {
                range,
                hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
            };
            switch (change.type) {
                case 'added':
                    addedDecorations.push(decoration);
                    break;
                case 'modified':
                    modifiedDecorations.push(decoration);
                    break;
                case 'deleted':
                    deletedDecorations.push(decoration);
                    break;
            }
        }
        editor.setDecorations(this.addedDecorationType, addedDecorations);
        editor.setDecorations(this.decorationType, modifiedDecorations);
        editor.setDecorations(this.deletedDecorationType, deletedDecorations);
    }
    getHoverMessage(type, startLine, endLine) {
        const lineText = startLine === endLine ? `line ${startLine + 1}` : `lines ${startLine + 1}-${endLine + 1}`;
        const branch = this.targetBranch;
        switch (type) {
            case 'added':
                return `Added ${lineText} (not in ${branch})`;
            case 'modified':
                return `Modified ${lineText} (different from ${branch})`;
            case 'deleted':
                return `Deleted ${lineText} (exists in ${branch})`;
        }
    }
}
//# sourceMappingURL=extension.js.map