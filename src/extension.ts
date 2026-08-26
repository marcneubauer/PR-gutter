import * as vscode from 'vscode';
import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'path';

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel('PR Gutter');

export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('PR Gutter: Extension activating...');
    console.log('PR Gutter: Extension activating...');

    try {
        const gitDiffProvider = new GitDiffProvider(context, outputChannel);

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('pr-gutter.setTargetBranch', async () => {
                try {
                    await gitDiffProvider.setTargetBranch();
                } catch (error) {
                    vscode.window.showErrorMessage(`PR Gutter: ${error}`);
                }
            }),
            vscode.commands.registerCommand('pr-gutter.refreshDiff', async () => {
                try {
                    await gitDiffProvider.refreshDiff();
                } catch (error) {
                    vscode.window.showErrorMessage(`PR Gutter: ${error}`);
                }
            }),
            vscode.commands.registerCommand('pr-gutter.showDebugInfo', async () => {
                try {
                    await gitDiffProvider.showDebugInfo();
                } catch (error) {
                    vscode.window.showErrorMessage(`PR Gutter: ${error}`);
                }
            })
        );

        console.log('PR Gutter: Commands registered successfully');

        // Initialize the provider
        gitDiffProvider.initialize().catch(error => {
            console.error('PR Gutter: Error initializing provider:', error);
            vscode.window.showErrorMessage(`PR Gutter initialization failed: ${error}`);
        });

        outputChannel.appendLine('PR Gutter: Extension activated successfully');
        console.log('PR Gutter: Extension activated successfully');
        const showStartupNotification = vscode.workspace.getConfiguration('pr-gutter').get<boolean>('showStartupNotification', true);
        if (showStartupNotification) {
            vscode.window.showInformationMessage('PR Gutter extension activated');
        }

    } catch (error) {
        console.error('PR Gutter: Error during activation:', error);
        vscode.window.showErrorMessage(`PR Gutter activation failed: ${error}`);
    }
}

export function deactivate() {
    outputChannel.appendLine('PR Gutter: Extension deactivating...');
}

interface DiffChange {
    startLine: number;
    endLine: number;
    type: 'added' | 'modified' | 'deleted';
}

class GitDiffProvider {
    private decorationType: vscode.TextEditorDecorationType;
    private addedDecorationType: vscode.TextEditorDecorationType;
    private addedFirstLineDecorationType: vscode.TextEditorDecorationType;
    private addedMiddleLineDecorationType: vscode.TextEditorDecorationType;
    private addedLastLineDecorationType: vscode.TextEditorDecorationType;
    private addedSingleLineDecorationType: vscode.TextEditorDecorationType;
    private modifiedSingleLineDecorationType: vscode.TextEditorDecorationType;
    private modifiedFirstLineDecorationType: vscode.TextEditorDecorationType;
    private modifiedMiddleLineDecorationType: vscode.TextEditorDecorationType;
    private modifiedLastLineDecorationType: vscode.TextEditorDecorationType;
    private deletedDecorationType: vscode.TextEditorDecorationType;
    private git: SimpleGit | undefined;
    private workspaceRoot: string | undefined;
    private targetBranch: string = 'main';
    private targetBranchSetting: string = '';
    private targetCommit: string = '';
    private showOutline: boolean = true;
    private warnedTargets = new Set<string>();
    private warnedDetachedHead = false;

    constructor(private context: vscode.ExtensionContext, private outputChannel: vscode.OutputChannel) {
        this.outputChannel.appendLine('PR Gutter: GitDiffProvider constructor called');
        console.log('PR Gutter: GitDiffProvider constructor called');

        try {
            // Create decoration types for different change types
            const showGutterIcons = vscode.workspace.getConfiguration('pr-gutter').get<boolean>('showGutterIcons', true);
            const modifiedGutterIcon = showGutterIcons ? {
                gutterIconPath: context.asAbsolutePath('resources/question.svg'),
                gutterIconSize: 'contain'
            } : {};
            const addedGutterIcon = showGutterIcons ? {
                gutterIconPath: context.asAbsolutePath('resources/lol.svg'),
                gutterIconSize: 'contain'
            } : {};
            const deletedGutterIcon = showGutterIcons ? {
                gutterIconPath: context.asAbsolutePath('resources/bacon.svg'),
                gutterIconSize: 'contain'
            } : {};

            // Single line modified (all borders)
            this.modifiedSingleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(255, 165, 0, 0.8)',
                ...modifiedGutterIcon
            });

            // First line of multi-line modified (top, left, right)
            this.modifiedFirstLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 0 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(255, 165, 0, 0.8)',
                ...modifiedGutterIcon
            });

            // Middle lines of multi-line modified (left, right)
            this.modifiedMiddleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 0 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(255, 165, 0, 0.8)'
            });

            // Last line of multi-line modified (bottom, left, right)
            this.modifiedLastLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(255, 165, 0, 0.8)'
            });

            // Legacy decoration type (kept for compatibility)
            this.decorationType = this.modifiedSingleLineDecorationType;

            // Single line addition (all borders)
            this.addedSingleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(0, 255, 0, 0.8)',
                ...addedGutterIcon
            });

            // First line of multi-line addition (top, left, right)
            this.addedFirstLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 0 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(0, 255, 0, 0.8)',
                ...addedGutterIcon
            });

            // Middle lines of multi-line addition (left, right)
            this.addedMiddleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 0 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(0, 255, 0, 0.8)'
            });

            // Last line of multi-line addition (bottom, left, right)
            this.addedLastLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: 'rgba(0, 255, 0, 0.8)'
            });

            // Legacy decoration type (kept for compatibility)
            this.addedDecorationType = this.addedSingleLineDecorationType;

            this.deletedDecorationType = vscode.window.createTextEditorDecorationType({
                ...deletedGutterIcon
            });

            console.log('PR Gutter: Decoration types created successfully');
        } catch (error) {
            console.error('PR Gutter: Error in constructor:', error);
            throw error;
        }
    }

    async initialize() {
        // Get workspace root
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            console.log(`PR Gutter: Detected workspace root: ${this.workspaceRoot}`);

            this.git = simpleGit(this.workspaceRoot);

            // Test if this is actually a git repository
            try {
                const isRepo = await this.git.checkIsRepo();
                console.log(`PR Gutter: Is git repository: ${isRepo}`);
                if (!isRepo) {
                    console.log('PR Gutter: Not a git repository, skipping initialization');
                    return;
                }
            } catch (error) {
                console.error('PR Gutter: Error checking git repository:', error);
                return;
            }

            // Get target branch from configuration (auto-detecting if unset)
            await this.updateTargetBranch();

            // Listen to configuration changes
            vscode.workspace.onDidChangeConfiguration(async (event: vscode.ConfigurationChangeEvent) => {
                if (event.affectsConfiguration('pr-gutter.targetBranch') || event.affectsConfiguration('pr-gutter.targetCommit') || event.affectsConfiguration('pr-gutter.showOutline')) {
                    await this.updateTargetBranch();
                    this.refreshDiff();
                }
            });

            // Listen to file changes
            const autoRefresh = vscode.workspace.getConfiguration('pr-gutter').get<boolean>('autoRefresh', true);
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
        } else {
            console.log('PR Gutter: No workspace folders found');
        }
    }

    private async updateTargetBranch() {
        const config = vscode.workspace.getConfiguration('pr-gutter');
        this.targetBranchSetting = config.get<string>('targetBranch', '');
        this.targetCommit = config.get<string>('targetCommit', '');
        this.showOutline = config.get<boolean>('showOutline', true);

        if (this.targetBranchSetting) {
            this.targetBranch = this.targetBranchSetting;
        } else {
            this.targetBranch = await this.detectDefaultBranch();
            this.outputChannel.appendLine(`PR Gutter: Auto-detected default branch: ${this.targetBranch}`);
        }
    }

    /**
     * Detect the repository's default branch: prefer origin/HEAD, then fall back
     * to common default branch names that exist locally or on origin.
     */
    private async detectDefaultBranch(): Promise<string> {
        if (!this.git) {
            return 'main';
        }

        try {
            const ref = (await this.git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
            if (ref) {
                return ref.replace(/^origin\//, '');
            }
        } catch {
            // No origin/HEAD ref (e.g. no remote, or never fetched) - fall through
        }

        try {
            const branches = await this.git.branch();
            for (const candidate of ['main', 'master', 'develop', 'trunk']) {
                if (branches.all.includes(candidate) || branches.all.includes(`remotes/origin/${candidate}`)) {
                    return candidate;
                }
            }
        } catch {
            // ignore and fall through to default
        }

        return 'main';
    }

    async setTargetBranch() {
        if (!this.git) {
            vscode.window.showErrorMessage('No git repository found');
            return;
        }

        try {
            // Get all branches
            const branches = await this.git.branch();
            const branchNames = branches.all.filter((branch: string) => !branch.startsWith('remotes/'));

            const autoDetectLabel = 'Auto-detect (use repository default branch)';
            const selectedBranch = await vscode.window.showQuickPick([autoDetectLabel, ...branchNames], {
                placeHolder: 'Select target branch to compare against'
            });

            if (selectedBranch === autoDetectLabel) {
                await vscode.workspace.getConfiguration('pr-gutter').update('targetBranch', '', vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage('Target branch set to auto-detect');
            } else if (selectedBranch) {
                await vscode.workspace.getConfiguration('pr-gutter').update('targetBranch', selectedBranch, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage(`Target branch set to: ${selectedBranch}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error getting branches: ${error}`);
        }
    }

    /**
     * Warn about a bad comparison target at most once per target value,
     * offering a quick way to pick a valid branch.
     */
    private warnOnceAboutTarget(message: string, target: string) {
        if (this.warnedTargets.has(target)) {
            return;
        }
        this.warnedTargets.add(target);
        vscode.window.showWarningMessage(message, 'Pick Branch...').then(choice => {
            if (choice === 'Pick Branch...') {
                this.setTargetBranch();
            }
        });
    }

    async showDebugInfo() {
        if (!this.git || !this.workspaceRoot) {
            vscode.window.showErrorMessage('No git repository found');
            return;
        }

        try {
            // Add debugging for workspace detection
            console.log('PR Gutter: Workspace root:', this.workspaceRoot);
            console.log('PR Gutter: Working directory check...');

            // Test if the workspace is actually a git repo
            const isRepo = await this.git.checkIsRepo();
            console.log('PR Gutter: Is git repo:', isRepo);

            if (!isRepo) {
                vscode.window.showErrorMessage(`Directory ${this.workspaceRoot} is not a git repository`);
                return;
            }

            const status = await this.git.status();
            const branches = await this.git.branch();
            const activeEditor = vscode.window.activeTextEditor;

            let debugInfo = `**PR Gutter Debug Info**\n\n`;
            debugInfo += `Workspace root: ${this.workspaceRoot}\n`;
            debugInfo += `Is git repo: ${isRepo}\n`;
            debugInfo += `Current branch: ${status.current}\n`;
            debugInfo += `Target branch: ${this.targetBranch}${this.targetBranchSetting ? '' : ' (auto-detected)'}\n`;
            debugInfo += `Available branches: ${branches.all.join(', ')}\n`;

            if (activeEditor) {
                const filePath = activeEditor.document.fileName;
                const relativePath = path.relative(this.workspaceRoot, filePath);
                debugInfo += `Active file: ${relativePath}\n`;

                // Test diff command with more specific logging
                try {
                    console.log(`PR Gutter: Testing diff for ${relativePath}`);
                    const diffResult = await this.git.diff([`${this.targetBranch}...HEAD`, '--', relativePath]);
                    debugInfo += `Diff result length: ${diffResult.length} chars\n`;
                    if (diffResult.trim()) {
                        debugInfo += `Diff preview:\n\`\`\`\n${diffResult.substring(0, 500)}\n\`\`\`\n`;

                        // Parse and show changes
                        const changes = this.parseDiff(diffResult);
                        debugInfo += `Parsed changes: ${changes.length}\n`;
                        changes.forEach((change, i) => {
                            debugInfo += `  Change ${i + 1}: ${change.type} lines ${change.startLine + 1}-${change.endLine + 1}\n`;
                        });
                    } else {
                        debugInfo += `No differences found between ${this.targetBranch} and HEAD for this file.\n`;
                    }
                } catch (error) {
                    console.error('PR Gutter: Diff error:', error);
                    debugInfo += `Diff error: ${error}\n`;
                }
            } else {
                debugInfo += `No active editor\n`;
            }

            // Show in output channel
            const outputChannel = vscode.window.createOutputChannel('PR Gutter Debug');
            outputChannel.clear();
            outputChannel.append(debugInfo);
            outputChannel.show();

        } catch (error) {
            console.error('PR Gutter: Debug info error:', error);
            vscode.window.showErrorMessage(`Debug info error: ${error}`);
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
                // Detached HEAD (e.g. mid-rebase) - don't spam popups, just log once
                if (!this.warnedDetachedHead) {
                    this.outputChannel.appendLine('PR Gutter: Not on any branch (detached HEAD?); skipping diff.');
                    this.warnedDetachedHead = true;
                }
                this.clearDecorations();
                return;
            }
            this.warnedDetachedHead = false;

            // If using commit hash, validate it exists
            if (this.targetCommit) {
                try {
                    await this.git.revparse([this.targetCommit]);
                } catch {
                    this.warnOnceAboutTarget(`PR Gutter: target commit '${this.targetCommit}' not found.`, this.targetCommit);
                    this.clearDecorations();
                    return;
                }
            } else {
                // Check if target branch exists locally or remotely
                const branches = await this.git.branch();
                const targetExists = branches.all.includes(this.targetBranch) ||
                                   branches.all.includes(`remotes/origin/${this.targetBranch}`);

                if (!targetExists) {
                    this.warnOnceAboutTarget(`PR Gutter: target branch '${this.targetBranch}' not found.`, this.targetBranch);
                    this.clearDecorations();
                    return;
                }

                // Don't compare if we're already on the target branch
                if (currentBranch === this.targetBranch) {
                    // Clear all decorations
                    this.clearDecorations();
                    return;
                }
            }

            // Update decorations for currently visible editors
            this.updateDecorations();

        } catch (error) {
            console.error('Error refreshing diff:', error);
            vscode.window.showErrorMessage(`Error refreshing diff: ${error}`);
        }
    }

    private clearDecorations() {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            activeEditor.setDecorations(this.addedSingleLineDecorationType, []);
            activeEditor.setDecorations(this.addedFirstLineDecorationType, []);
            activeEditor.setDecorations(this.addedMiddleLineDecorationType, []);
            activeEditor.setDecorations(this.addedLastLineDecorationType, []);
            activeEditor.setDecorations(this.modifiedSingleLineDecorationType, []);
            activeEditor.setDecorations(this.modifiedFirstLineDecorationType, []);
            activeEditor.setDecorations(this.modifiedMiddleLineDecorationType, []);
            activeEditor.setDecorations(this.modifiedLastLineDecorationType, []);
            activeEditor.setDecorations(this.deletedDecorationType, []);
        }
    }

    private async updateDecorations() {
        console.log('PR Gutter: updateDecorations called');
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || !this.git || !this.workspaceRoot) {
            console.log('PR Gutter: Missing dependencies - activeEditor:', !!activeEditor, 'git:', !!this.git, 'workspaceRoot:', !!this.workspaceRoot);
            return;
        }

        const filePath = activeEditor.document.fileName;
        console.log('PR Gutter: Current file path:', filePath);

        // Skip non-file schemes (like git:, output:, etc.)
        if (!filePath.startsWith(this.workspaceRoot)) {
            console.log('PR Gutter: File not in workspace, skipping');
            return;
        }

        const relativePath = path.relative(this.workspaceRoot, filePath);
        console.log('PR Gutter: Relative path:', relativePath);        try {
            // Try different diff strategies
            let diffResult = '';
            let diffCommand = '';

            // Determine what to compare against: commit hash or branch
            const target = this.targetCommit || this.targetBranch;
            const isCommit = !!this.targetCommit;

            if (isCommit) {
                // If target is a commit hash, use it directly
                try {
                    diffCommand = `${target}...HEAD`;
                    diffResult = await this.git.diff([diffCommand, '--', relativePath]);
                } catch {
                    try {
                        diffCommand = `${target}..HEAD`;
                        diffResult = await this.git.diff([diffCommand, '--', relativePath]);
                    } catch {
                        diffCommand = `${target} HEAD`;
                        diffResult = await this.git.diff([target, 'HEAD', '--', relativePath]);
                    }
                }
            } else {
                // If target is a branch, try different strategies
                try {
                    // First try: compare with remote branch if it exists
                    diffCommand = `origin/${target}...HEAD`;
                    diffResult = await this.git.diff([diffCommand, '--', relativePath]);
                } catch {
                    try {
                        // Second try: compare with local branch
                        diffCommand = `${target}...HEAD`;
                        diffResult = await this.git.diff([diffCommand, '--', relativePath]);
                    } catch {
                        try {
                            // Third try: compare with branch directly
                            diffCommand = `${target}..HEAD`;
                            diffResult = await this.git.diff([diffCommand, '--', relativePath]);
                        } catch {
                            // Fourth try: simple diff
                            diffCommand = `${target} HEAD`;
                            diffResult = await this.git.diff([target, 'HEAD', '--', relativePath]);
                        }
                    }
                }
            }

            // Debug output
            console.log(`PR Gutter: Comparing ${diffCommand} for ${relativePath}`);
            console.log(`PR Gutter: Diff result length: ${diffResult.length}`);
            if (diffResult.trim()) {
                console.log(`PR Gutter: Diff preview:`, diffResult.substring(0, 200));
            }

            const changes = this.parseDiff(diffResult);
            this.outputChannel.appendLine(`PR Gutter1: Found ${changes.length} changes`);
            this.outputChannel.appendLine(`PR Gutter1: Changes: ${JSON.stringify(changes)}`);
            console.log(`PR Gutter2: Found ${changes.length} changes`);

            this.outputChannel.appendLine('PR Gutter1: About to call applyDecorations');
            console.log('PR Gutter2: About to call applyDecorations');
            // Apply decorations
            this.applyDecorations(activeEditor, changes);
            this.outputChannel.appendLine('PR Gutter1: applyDecorations returned');
            console.log('PR Gutter2: applyDecorations returned');
        } catch (error) {
            console.error('PR Gutter2: Error in updateDecorations:', error);
            console.error('Error getting diff for file:', relativePath, error);
            // Clear decorations on error
            this.clearDecorations();
        }
    }

    private parseDiff(diffText: string): DiffChange[] {
        const changes: DiffChange[] = [];
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
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                // Deleted line (shown at current position)
                changes.push({
                    startLine: currentNewLine,
                    endLine: currentNewLine,
                    type: 'deleted'
                });
                // Don't increment currentNewLine for deleted lines in the new file
            } else if (line.startsWith(' ')) {
                // Context line - exists in both versions
                currentNewLine++;
            } else if (line.startsWith('\\')) {
                // "No newline at end of file" - ignore
                continue;
            }
        }

        // Merge consecutive changes of the same type for better visualization
        return this.mergeConsecutiveChanges(changes);
    }

    private mergeConsecutiveChanges(changes: DiffChange[]): DiffChange[] {
        if (changes.length === 0) {
            return changes;
        }

        const merged: DiffChange[] = [];
        let current = changes[0];

        for (let i = 1; i < changes.length; i++) {
            const next = changes[i];

            // Merge if same type and consecutive lines
            if (current.type === next.type && current.endLine + 1 === next.startLine) {
                current.endLine = next.endLine;
            } else {
                merged.push(current);
                current = next;
            }
        }

        merged.push(current);
        return merged;
    }

    private applyDecorations(editor: vscode.TextEditor, changes: DiffChange[]) {
        this.outputChannel.appendLine(`PR Gutter1: applyDecorations called with ${changes.length} changes`);
        this.outputChannel.appendLine(`PR Gutter1: Changes: ${JSON.stringify(changes)}`);
        console.log('PR Gutter: applyDecorations called with', changes.length, 'changes');
        console.log('PR Gutter: Changes details:', JSON.stringify(changes));

        const addedSingleLineDecorations: vscode.DecorationOptions[] = [];
        const addedFirstLineDecorations: vscode.DecorationOptions[] = [];
        const addedMiddleLineDecorations: vscode.DecorationOptions[] = [];
        const addedLastLineDecorations: vscode.DecorationOptions[] = [];
        const modifiedSingleLineDecorations: vscode.DecorationOptions[] = [];
        const modifiedFirstLineDecorations: vscode.DecorationOptions[] = [];
        const modifiedMiddleLineDecorations: vscode.DecorationOptions[] = [];
        const modifiedLastLineDecorations: vscode.DecorationOptions[] = [];
        const deletedDecorations: vscode.DecorationOptions[] = [];

        for (const change of changes) {
            // Ensure line numbers are within document bounds
            const startLine = Math.max(0, Math.min(change.startLine, editor.document.lineCount - 1));
            const endLine = Math.max(0, Math.min(change.endLine, editor.document.lineCount - 1));

            if (startLine >= editor.document.lineCount) {
                continue;
            }

            if (change.type === 'added') {
                if (this.showOutline) {
                    // Handle added lines with proper border decoration based on position
                    const lineCount = endLine - startLine + 1;

                    if (lineCount === 1) {
                        // Single line addition - use all borders
                        const range = new vscode.Range(startLine, 0, startLine, 0);
                        addedSingleLineDecorations.push({
                            range,
                            hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
                        });
                    } else {
                        // Multi-line addition - apply different borders to first, middle, and last lines
                        for (let line = startLine; line <= endLine; line++) {
                            const range = new vscode.Range(line, 0, line, 0);
                            const decoration = {
                                range,
                                hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
                            };

                            if (line === startLine) {
                                // First line: top, left, right borders
                                addedFirstLineDecorations.push(decoration);
                            } else if (line === endLine) {
                                // Last line: bottom, left, right borders
                                addedLastLineDecorations.push(decoration);
                            } else {
                                // Middle lines: left, right borders only
                                addedMiddleLineDecorations.push(decoration);
                            }
                        }
                    }
                } else {
                    // No outline - just show gutter icon on first line
                    const range = new vscode.Range(startLine, 0, startLine, 0);
                    addedSingleLineDecorations.push({
                        range,
                        hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
                    });
                }
            } else if (change.type === 'modified') {
                if (this.showOutline) {
                    // Handle modified lines with proper border decoration based on position
                    const lineCount = endLine - startLine + 1;

                    if (lineCount === 1) {
                        // Single line modified - use all borders
                        const range = new vscode.Range(startLine, 0, startLine, 0);
                        modifiedSingleLineDecorations.push({
                            range,
                            hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
                        });
                    } else {
                        // Multi-line modified - apply different borders to first, middle, and last lines
                        for (let line = startLine; line <= endLine; line++) {
                            const range = new vscode.Range(line, 0, line, 0);
                            const decoration = {
                                range,
                                hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
                            };

                            if (line === startLine) {
                                // First line: top, left, right borders
                                modifiedFirstLineDecorations.push(decoration);
                            } else if (line === endLine) {
                                // Last line: bottom, left, right borders
                                modifiedLastLineDecorations.push(decoration);
                            } else {
                                // Middle lines: left, right borders only
                                modifiedMiddleLineDecorations.push(decoration);
                            }
                        }
                    }
                } else {
                    // No outline - just show gutter icon on first line
                    const range = new vscode.Range(startLine, 0, startLine, 0);
                    modifiedSingleLineDecorations.push({
                        range,
                        hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
                    });
                }
            } else if (change.type === 'deleted') {
                // Handle deleted lines
                const range = new vscode.Range(startLine, 0, endLine, 0);
                deletedDecorations.push({
                    range,
                    hoverMessage: this.getHoverMessage(change.type, startLine, endLine)
                });
            }
        }

        this.outputChannel.appendLine(`PR Gutter1: Applying decorations - added single: ${addedSingleLineDecorations.length}, first: ${addedFirstLineDecorations.length}, middle: ${addedMiddleLineDecorations.length}, last: ${addedLastLineDecorations.length}, modified single: ${modifiedSingleLineDecorations.length}, first: ${modifiedFirstLineDecorations.length}, middle: ${modifiedMiddleLineDecorations.length}, last: ${modifiedLastLineDecorations.length}, deleted: ${deletedDecorations.length}`);
        console.log('PR Gutter: Applying decorations - added single:', addedSingleLineDecorations.length, 'first:', addedFirstLineDecorations.length, 'middle:', addedMiddleLineDecorations.length, 'last:', addedLastLineDecorations.length, 'modified single:', modifiedSingleLineDecorations.length, 'first:', modifiedFirstLineDecorations.length, 'middle:', modifiedMiddleLineDecorations.length, 'last:', modifiedLastLineDecorations.length, 'deleted:', deletedDecorations.length);

        editor.setDecorations(this.addedSingleLineDecorationType, addedSingleLineDecorations);
        editor.setDecorations(this.addedFirstLineDecorationType, addedFirstLineDecorations);
        editor.setDecorations(this.addedMiddleLineDecorationType, addedMiddleLineDecorations);
        editor.setDecorations(this.addedLastLineDecorationType, addedLastLineDecorations);
        editor.setDecorations(this.modifiedSingleLineDecorationType, modifiedSingleLineDecorations);
        editor.setDecorations(this.modifiedFirstLineDecorationType, modifiedFirstLineDecorations);
        editor.setDecorations(this.modifiedMiddleLineDecorationType, modifiedMiddleLineDecorations);
        editor.setDecorations(this.modifiedLastLineDecorationType, modifiedLastLineDecorations);
        editor.setDecorations(this.deletedDecorationType, deletedDecorations);

        console.log('PR Gutter: Decorations applied successfully');
    }

    private getHoverMessage(type: 'added' | 'modified' | 'deleted', startLine: number, endLine: number): string {
        const lineText = startLine === endLine ? `line ${startLine + 1}` : `lines ${startLine + 1}-${endLine + 1}`;
        const target = this.targetCommit ? `commit ${this.targetCommit.substring(0, 7)}` : this.targetBranch;

        switch (type) {
            case 'added':
                return `Added ${lineText} (not in ${target})`;
            case 'modified':
                return `Modified ${lineText} (different from ${target})`;
            case 'deleted':
                return `Deleted ${lineText} (exists in ${target})`;
        }
    }
}
