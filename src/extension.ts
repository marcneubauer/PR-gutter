import * as vscode from 'vscode';
import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { DiffChange, parseDiff } from './diffParser';

const execFileAsync = promisify(execFile);

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
    private cachedDiffBase: string | undefined;
    private cachedDiffBaseKey: string | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;
    private baselineCache = new Map<string, string>();

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

            // Theme-aware colors: follow the active color theme instead of
            // hardcoded RGB values, and mark changes in the overview ruler
            const addedColor = new vscode.ThemeColor('editorGutter.addedBackground');
            const modifiedColor = new vscode.ThemeColor('editorGutter.modifiedBackground');
            const addedRuler = {
                overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
                overviewRulerLane: vscode.OverviewRulerLane.Left
            };
            const modifiedRuler = {
                overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
                overviewRulerLane: vscode.OverviewRulerLane.Left
            };
            const deletedRuler = {
                overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
                overviewRulerLane: vscode.OverviewRulerLane.Left
            };

            // Single line modified (all borders)
            this.modifiedSingleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: modifiedColor,
                ...modifiedRuler,
                ...modifiedGutterIcon
            });

            // First line of multi-line modified (top, left, right)
            this.modifiedFirstLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 0 2px',
                borderStyle: 'solid',
                borderColor: modifiedColor,
                ...modifiedRuler,
                ...modifiedGutterIcon
            });

            // Middle lines of multi-line modified (left, right)
            this.modifiedMiddleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 0 2px',
                borderStyle: 'solid',
                borderColor: modifiedColor,
                ...modifiedRuler
            });

            // Last line of multi-line modified (bottom, left, right)
            this.modifiedLastLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: modifiedColor,
                ...modifiedRuler
            });

            // Legacy decoration type (kept for compatibility)
            this.decorationType = this.modifiedSingleLineDecorationType;

            // Single line addition (all borders)
            this.addedSingleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: addedColor,
                ...addedRuler,
                ...addedGutterIcon
            });

            // First line of multi-line addition (top, left, right)
            this.addedFirstLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '1px 1px 0 2px',
                borderStyle: 'solid',
                borderColor: addedColor,
                ...addedRuler,
                ...addedGutterIcon
            });

            // Middle lines of multi-line addition (left, right)
            this.addedMiddleLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 0 2px',
                borderStyle: 'solid',
                borderColor: addedColor,
                ...addedRuler
            });

            // Last line of multi-line addition (bottom, left, right)
            this.addedLastLineDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                borderWidth: '0 1px 1px 2px',
                borderStyle: 'solid',
                borderColor: addedColor,
                ...addedRuler
            });

            // Legacy decoration type (kept for compatibility)
            this.addedDecorationType = this.addedSingleLineDecorationType;

            this.deletedDecorationType = vscode.window.createTextEditorDecorationType({
                ...deletedRuler,
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
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.workspaceRoot = workspaceRoot;
            console.log(`PR Gutter: Detected workspace root: ${this.workspaceRoot}`);

            this.git = simpleGit(workspaceRoot);

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
                vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
                    // Only re-diff when the saved document is the one being displayed
                    if (document === vscode.window.activeTextEditor?.document) {
                        this.scheduleUpdate();
                    }
                });

                vscode.window.onDidChangeActiveTextEditor(() => {
                    this.scheduleUpdate();
                });

                // Live updates while typing (unsaved changes)
                const liveUpdate = vscode.workspace.getConfiguration('pr-gutter').get<boolean>('liveUpdate', true);
                if (liveUpdate) {
                    vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
                        if (event.contentChanges.length > 0 && event.document === vscode.window.activeTextEditor?.document) {
                            this.scheduleUpdate(300);
                        }
                    });
                }
            }

            // Invalidate the cached diff base when git state moves
            // (branch switches, commits, fetches)
            const gitWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceRoot, '.git/{HEAD,refs/**}')
            );
            const onGitStateChange = () => {
                this.invalidateDiffBase();
                this.scheduleUpdate(300);
            };
            gitWatcher.onDidChange(onGitStateChange);
            gitWatcher.onDidCreate(onGitStateChange);
            gitWatcher.onDidDelete(onGitStateChange);

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

    private invalidateDiffBase() {
        this.cachedDiffBase = undefined;
        this.cachedDiffBaseKey = undefined;
        this.baselineCache.clear();
    }

    /**
     * Resolve the commit to diff the working tree against: the merge-base of
     * HEAD and the target (origin/<branch> preferred, then local <branch>, or
     * the configured commit). Cached until the target setting changes or git
     * state moves (branch switch, commit, fetch).
     */
    private async resolveDiffBase(): Promise<string | undefined> {
        if (!this.git) {
            return undefined;
        }

        const key = this.targetCommit || this.targetBranch;
        if (this.cachedDiffBase && this.cachedDiffBaseKey === key) {
            return this.cachedDiffBase;
        }

        let targetRef: string | undefined;
        if (this.targetCommit) {
            try {
                await this.git.revparse(['--verify', `${this.targetCommit}^{commit}`]);
                targetRef = this.targetCommit;
            } catch {
                this.warnOnceAboutTarget(`PR Gutter: target commit '${this.targetCommit}' not found.`, this.targetCommit);
                return undefined;
            }
        } else {
            // Existence check for a single ref - avoids listing every branch
            for (const candidate of [`refs/remotes/origin/${this.targetBranch}`, `refs/heads/${this.targetBranch}`]) {
                try {
                    await this.git.raw(['show-ref', '--verify', '--quiet', candidate]);
                    targetRef = candidate;
                    break;
                } catch {
                    // ref does not exist - try next candidate
                }
            }
            if (!targetRef) {
                this.warnOnceAboutTarget(`PR Gutter: target branch '${this.targetBranch}' not found.`, this.targetBranch);
                return undefined;
            }
        }

        try {
            const base = (await this.git.raw(['merge-base', 'HEAD', targetRef])).trim();
            this.cachedDiffBase = base;
            this.cachedDiffBaseKey = key;
            this.outputChannel.appendLine(`PR Gutter: diff base ${base.substring(0, 7)} (merge-base of HEAD and ${targetRef})`);
            return base;
        } catch (error) {
            // Disjoint histories or unborn HEAD
            this.outputChannel.appendLine(`PR Gutter: could not compute merge-base of HEAD and ${targetRef}: ${error}`);
            return undefined;
        }
    }

    private toGitPath(relativePath: string): string {
        return relativePath.split(path.sep).join('/');
    }

    /**
     * Contents of the file at the diff base, cached per base+path.
     * Returns '' when the file does not exist at the base (newly added file).
     */
    private async getBaselineContent(base: string, relativePath: string): Promise<string> {
        const key = `${base}:${relativePath}`;
        const cached = this.baselineCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        let content = '';
        if (this.git) {
            try {
                content = await this.git.show([`${base}:${this.toGitPath(relativePath)}`]);
            } catch {
                // File does not exist at the base - treat as empty
            }
        }
        this.baselineCache.set(key, content);
        return content;
    }

    /**
     * Diff two files on disk. git exits with code 1 when the files differ,
     * which execFile reports as an error - treat it as success.
     */
    private async diffNoIndex(fileA: string, fileB: string): Promise<string> {
        try {
            const { stdout } = await execFileAsync(
                'git', ['diff', '--no-index', '--', fileA, fileB],
                { cwd: this.workspaceRoot, maxBuffer: 50 * 1024 * 1024 }
            );
            return stdout;
        } catch (error) {
            const e = error as { code?: unknown; stdout?: unknown };
            if (e && e.code === 1 && typeof e.stdout === 'string') {
                return e.stdout;
            }
            throw error;
        }
    }

    /**
     * Diff an unsaved buffer against the baseline content at the diff base,
     * using temp files so unsaved edits are reflected immediately.
     */
    private async diffBuffer(base: string, relativePath: string, bufferText: string): Promise<string> {
        const baseline = await this.getBaselineContent(base, relativePath);
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-gutter-'));
        const fileA = path.join(dir, 'base');
        const fileB = path.join(dir, 'buffer');
        try {
            await Promise.all([
                fs.writeFile(fileA, baseline, 'utf8'),
                fs.writeFile(fileB, bufferText, 'utf8')
            ]);
            return await this.diffNoIndex(fileA, fileB);
        } finally {
            fs.rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ });
        }
    }

    /**
     * Debounced decoration update - collapses bursts of triggers
     * (Save All, format-on-save, typing, rapid editor switches) into one refresh.
     */
    private scheduleUpdate(delayMs: number = 150) {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            this.updateDecorations();
        }, delayMs);
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
                    const base = await this.resolveDiffBase();
                    debugInfo += `Diff base: ${base ?? 'unresolved'}\n`;
                    const diffResult = base ? await this.git.diff([base, '--', relativePath]) : '';
                    debugInfo += `Diff result length: ${diffResult.length} chars\n`;
                    if (diffResult.trim()) {
                        debugInfo += `Diff preview:\n\`\`\`\n${diffResult.substring(0, 500)}\n\`\`\`\n`;

                        // Parse and show changes
                        const changes = parseDiff(diffResult);
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
            // Full refresh: re-resolve the comparison base, then update decorations
            this.invalidateDiffBase();
            const base = await this.resolveDiffBase();
            if (!base) {
                this.clearDecorations();
                return;
            }

            await this.updateDecorations();

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
        console.log('PR Gutter: Relative path:', relativePath);
        try {
            // Diff the working tree against the cached merge-base - a single
            // git invocation, and it includes uncommitted changes
            const base = await this.resolveDiffBase();
            if (!base) {
                this.clearDecorations();
                return;
            }

            let diffResult: string;
            if (activeEditor.document.isDirty) {
                // Unsaved changes: diff the live buffer against the baseline
                diffResult = await this.diffBuffer(base, relativePath, activeEditor.document.getText());
                console.log(`PR Gutter: Live-diffed unsaved buffer against ${base.substring(0, 7)} for ${relativePath}`);
            } else {
                diffResult = await this.git.diff([base, '--', relativePath]);
                console.log(`PR Gutter: Comparing working tree against ${base.substring(0, 7)} for ${relativePath}`);
            }
            console.log(`PR Gutter: Diff result length: ${diffResult.length}`);
            if (diffResult.trim()) {
                console.log(`PR Gutter: Diff preview:`, diffResult.substring(0, 200));
            }

            const changes = parseDiff(diffResult);
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
