import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { DiffChange, parseDiff } from './diffParser';
import { GitCli } from './gitCli';

/** Per-workspace-folder git state (multi-root support). */
interface RepoContext {
    git: GitCli;
    root: string;
    isRepo?: boolean;
    detectedDefaultBranch?: string;
    cachedDiffBase?: string;
    cachedDiffBaseKey?: string;
    baselineCache: Map<string, string>;
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('PR Gutter');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('PR Gutter: Extension activating...');

    const gitDiffProvider = new GitDiffProvider(context, outputChannel);
    context.subscriptions.push(gitDiffProvider);

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

    // Initialize the provider
    gitDiffProvider.initialize().catch(error => {
        outputChannel.appendLine(`PR Gutter: Error initializing provider: ${error}`);
        vscode.window.showErrorMessage(`PR Gutter initialization failed: ${error}`);
    });

    outputChannel.appendLine('PR Gutter: Extension activated');
    const showStartupNotification = vscode.workspace.getConfiguration('pr-gutter').get<boolean>('showStartupNotification', false);
    if (showStartupNotification) {
        vscode.window.showInformationMessage('PR Gutter extension activated');
    }
}

export function deactivate() {
    // All resources are released via context.subscriptions
}

class GitDiffProvider implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly addedFirstLineDecorationType: vscode.TextEditorDecorationType;
    private readonly addedMiddleLineDecorationType: vscode.TextEditorDecorationType;
    private readonly addedLastLineDecorationType: vscode.TextEditorDecorationType;
    private readonly addedSingleLineDecorationType: vscode.TextEditorDecorationType;
    private readonly modifiedSingleLineDecorationType: vscode.TextEditorDecorationType;
    private readonly modifiedFirstLineDecorationType: vscode.TextEditorDecorationType;
    private readonly modifiedMiddleLineDecorationType: vscode.TextEditorDecorationType;
    private readonly modifiedLastLineDecorationType: vscode.TextEditorDecorationType;
    private readonly deletedDecorationType: vscode.TextEditorDecorationType;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly repos = new Map<string, RepoContext>();
    private targetBranchSetting: string = '';
    private targetCommit: string = '';
    private showOutline: boolean = true;
    private traceEnabled: boolean = false;
    private warnedTargets = new Set<string>();
    private refreshTimer: NodeJS.Timeout | undefined;
    private debugChannel: vscode.OutputChannel | undefined;

    constructor(private context: vscode.ExtensionContext, private outputChannel: vscode.OutputChannel) {
        // Status bar: shows the comparison target and the active file's change
        // counts; click to pick a different target branch
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'pr-gutter.setTargetBranch';
        this.statusBarItem.text = '$(git-compare) PR Gutter';
        this.statusBarItem.tooltip = 'PR Gutter: click to change the comparison target';
        this.disposables.push(this.statusBarItem);

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

        this.modifiedSingleLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '1px 1px 1px 2px',
            borderStyle: 'solid',
            borderColor: modifiedColor,
            ...modifiedRuler,
            ...modifiedGutterIcon
        });

        this.modifiedFirstLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '1px 1px 0 2px',
            borderStyle: 'solid',
            borderColor: modifiedColor,
            ...modifiedRuler,
            ...modifiedGutterIcon
        });

        this.modifiedMiddleLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '0 1px 0 2px',
            borderStyle: 'solid',
            borderColor: modifiedColor,
            ...modifiedRuler
        });

        this.modifiedLastLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '0 1px 1px 2px',
            borderStyle: 'solid',
            borderColor: modifiedColor,
            ...modifiedRuler
        });

        this.addedSingleLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '1px 1px 1px 2px',
            borderStyle: 'solid',
            borderColor: addedColor,
            ...addedRuler,
            ...addedGutterIcon
        });

        this.addedFirstLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '1px 1px 0 2px',
            borderStyle: 'solid',
            borderColor: addedColor,
            ...addedRuler,
            ...addedGutterIcon
        });

        this.addedMiddleLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '0 1px 0 2px',
            borderStyle: 'solid',
            borderColor: addedColor,
            ...addedRuler
        });

        this.addedLastLineDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '0 1px 1px 2px',
            borderStyle: 'solid',
            borderColor: addedColor,
            ...addedRuler
        });

        this.deletedDecorationType = vscode.window.createTextEditorDecorationType({
            ...deletedRuler,
            ...deletedGutterIcon
        });

        this.disposables.push(
            this.addedSingleLineDecorationType,
            this.addedFirstLineDecorationType,
            this.addedMiddleLineDecorationType,
            this.addedLastLineDecorationType,
            this.modifiedSingleLineDecorationType,
            this.modifiedFirstLineDecorationType,
            this.modifiedMiddleLineDecorationType,
            this.modifiedLastLineDecorationType,
            this.deletedDecorationType
        );
    }

    dispose() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
        this.debugChannel?.dispose();
    }

    private info(message: string) {
        this.outputChannel.appendLine(`PR Gutter: ${message}`);
    }

    private trace(message: string) {
        if (this.traceEnabled) {
            this.outputChannel.appendLine(`PR Gutter (trace): ${message}`);
        }
    }

    async initialize() {
        this.readConfig();

        // Listen to configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
                if (event.affectsConfiguration('pr-gutter')) {
                    this.readConfig();
                    this.resetRepoCaches();
                    this.scheduleUpdate();
                }
            })
        );

        // Listen to file changes
        const config = vscode.workspace.getConfiguration('pr-gutter');
        const autoRefresh = config.get<boolean>('autoRefresh', true);
        if (autoRefresh) {
            this.disposables.push(
                vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
                    // Only re-diff when the saved document is visible
                    if (vscode.window.visibleTextEditors.some(editor => editor.document === document)) {
                        this.scheduleUpdate();
                    }
                }),
                vscode.window.onDidChangeActiveTextEditor(() => {
                    this.scheduleUpdate();
                }),
                vscode.window.onDidChangeVisibleTextEditors(() => {
                    this.scheduleUpdate();
                })
            );

            // Live updates while typing (unsaved changes)
            const liveUpdate = config.get<boolean>('liveUpdate', true);
            if (liveUpdate) {
                this.disposables.push(
                    vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
                        if (event.contentChanges.length > 0 && event.document === vscode.window.activeTextEditor?.document) {
                            this.scheduleUpdate(300);
                        }
                    })
                );
            }
        }

        this.statusBarItem.show();

        // Initial diff update
        await this.refreshDiff();
    }

    private readConfig() {
        const config = vscode.workspace.getConfiguration('pr-gutter');
        this.targetBranchSetting = config.get<string>('targetBranch', '');
        this.targetCommit = config.get<string>('targetCommit', '');
        this.showOutline = config.get<boolean>('showOutline', true);
        this.traceEnabled = config.get<boolean>('trace', false);
    }

    private resetRepoCaches() {
        for (const ctx of this.repos.values()) {
            ctx.cachedDiffBase = undefined;
            ctx.cachedDiffBaseKey = undefined;
            ctx.detectedDefaultBranch = undefined;
            ctx.baselineCache.clear();
        }
    }

    /** Get (or lazily create) the repo context for a workspace folder root. */
    private getRepoForRoot(root: string): RepoContext {
        let ctx = this.repos.get(root);
        if (ctx) {
            return ctx;
        }

        const created: RepoContext = { git: new GitCli(root), root, baselineCache: new Map() };
        this.repos.set(root, created);

        // Invalidate this repo's caches when its git state moves
        // (branch switches, commits, fetches)
        const gitWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(root, '.git/{HEAD,refs/**}')
        );
        const onGitStateChange = () => {
            created.cachedDiffBase = undefined;
            created.cachedDiffBaseKey = undefined;
            created.detectedDefaultBranch = undefined;
            created.baselineCache.clear();
            this.scheduleUpdate(300);
        };
        gitWatcher.onDidChange(onGitStateChange);
        gitWatcher.onDidCreate(onGitStateChange);
        gitWatcher.onDidDelete(onGitStateChange);
        this.disposables.push(gitWatcher);

        return created;
    }

    /** Resolve the repo context for a document (multi-root aware). */
    private getRepoForDocument(document: vscode.TextDocument): RepoContext | undefined {
        if (document.uri.scheme !== 'file') {
            return undefined;
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) {
            return undefined;
        }
        return this.getRepoForRoot(folder.uri.fsPath);
    }

    private getActiveRepo(): RepoContext | undefined {
        const document = vscode.window.activeTextEditor?.document;
        if (document) {
            const ctx = this.getRepoForDocument(document);
            if (ctx) {
                return ctx;
            }
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder ? this.getRepoForRoot(folder.uri.fsPath) : undefined;
    }

    private async isRepo(ctx: RepoContext): Promise<boolean> {
        if (ctx.isRepo === undefined) {
            ctx.isRepo = await ctx.git.isRepo();
            this.trace(`${ctx.root} is git repository: ${ctx.isRepo}`);
        }
        return ctx.isRepo;
    }

    /** The branch this repo is compared against (configured or auto-detected). */
    private async targetBranchFor(ctx: RepoContext): Promise<string> {
        if (this.targetBranchSetting) {
            return this.targetBranchSetting;
        }
        if (!ctx.detectedDefaultBranch) {
            ctx.detectedDefaultBranch = await this.detectDefaultBranch(ctx.git);
            this.info(`Auto-detected default branch for ${ctx.root}: ${ctx.detectedDefaultBranch}`);
        }
        return ctx.detectedDefaultBranch;
    }

    /**
     * Detect the repository's default branch: prefer origin/HEAD, then fall back
     * to common default branch names that exist locally or on origin.
     */
    private async detectDefaultBranch(git: GitCli): Promise<string> {
        // origin/HEAD points at the remote's default branch (when fetched)
        const originHead = await git.symbolicRef('refs/remotes/origin/HEAD');
        if (originHead) {
            return originHead.replace(/^origin\//, '');
        }

        for (const candidate of ['main', 'master', 'develop', 'trunk']) {
            if (await git.refExists(`refs/heads/${candidate}`) || await git.refExists(`refs/remotes/origin/${candidate}`)) {
                return candidate;
            }
        }

        return 'main';
    }

    /**
     * Resolve the commit to diff the working tree against: the merge-base of
     * HEAD and the target (origin/<branch> preferred, then local <branch>, or
     * the configured commit). Cached per repo until the target setting changes
     * or git state moves (branch switch, commit, fetch).
     */
    private async resolveDiffBase(ctx: RepoContext): Promise<string | undefined> {
        const branch = this.targetCommit ? '' : await this.targetBranchFor(ctx);
        const key = this.targetCommit || branch;
        if (ctx.cachedDiffBase && ctx.cachedDiffBaseKey === key) {
            return ctx.cachedDiffBase;
        }

        let targetRef: string | undefined;
        if (this.targetCommit) {
            if (!(await ctx.git.isCommit(this.targetCommit))) {
                this.warnOnceAboutTarget(`PR Gutter: target commit '${this.targetCommit}' not found.`, this.targetCommit);
                return undefined;
            }
            targetRef = this.targetCommit;
        } else {
            // Existence check for a single ref - avoids listing every branch
            for (const candidate of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
                if (await ctx.git.refExists(candidate)) {
                    targetRef = candidate;
                    break;
                }
            }
            if (!targetRef) {
                this.warnOnceAboutTarget(`PR Gutter: target branch '${branch}' not found.`, branch);
                return undefined;
            }
        }

        try {
            const base = await ctx.git.mergeBase('HEAD', targetRef);
            ctx.cachedDiffBase = base;
            ctx.cachedDiffBaseKey = key;
            this.info(`diff base ${base.substring(0, 7)} (merge-base of HEAD and ${targetRef}) in ${ctx.root}`);
            return base;
        } catch (error) {
            // Disjoint histories or unborn HEAD
            this.info(`could not compute merge-base of HEAD and ${targetRef} in ${ctx.root}: ${error}`);
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
    private async getBaselineContent(ctx: RepoContext, base: string, relativePath: string): Promise<string> {
        const key = `${base}:${relativePath}`;
        const cached = ctx.baselineCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        let content = '';
        try {
            content = await ctx.git.show(`${base}:${this.toGitPath(relativePath)}`);
        } catch {
            // File does not exist at the base - treat as empty
        }
        ctx.baselineCache.set(key, content);
        return content;
    }

    /**
     * Diff an unsaved buffer against the baseline content at the diff base,
     * using temp files so unsaved edits are reflected immediately.
     */
    private async diffBuffer(ctx: RepoContext, base: string, relativePath: string, bufferText: string): Promise<string> {
        const baseline = await this.getBaselineContent(ctx, base, relativePath);
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-gutter-'));
        const fileA = path.join(dir, 'base');
        const fileB = path.join(dir, 'buffer');
        try {
            await Promise.all([
                fs.writeFile(fileA, baseline, 'utf8'),
                fs.writeFile(fileB, bufferText, 'utf8')
            ]);
            return await ctx.git.diffNoIndex(fileA, fileB);
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
            this.updateAllVisibleEditors();
        }, delayMs);
    }

    private async updateAllVisibleEditors() {
        for (const editor of vscode.window.visibleTextEditors) {
            await this.updateDecorationsForEditor(editor);
        }
    }

    async refreshDiff() {
        // Full refresh: re-resolve comparison bases, then update all editors
        this.warnedTargets.clear();
        this.resetRepoCaches();
        await this.updateAllVisibleEditors();
    }

    /**
     * Reflect the comparison target (and the active file's change counts,
     * when known) in the status bar.
     */
    private updateStatusBar(targetLabel: string, counts?: { added: number; modified: number; deleted: number }) {
        let text = `$(git-compare) ${targetLabel}`;
        if (counts && (counts.added > 0 || counts.modified > 0 || counts.deleted > 0)) {
            text += ` +${counts.added} ~${counts.modified} -${counts.deleted}`;
        }
        this.statusBarItem.text = text;

        const kind = this.targetCommit ? 'commit' : 'branch';
        const detected = this.targetCommit || this.targetBranchSetting ? '' : ' (auto-detected)';
        this.statusBarItem.tooltip = `PR Gutter: comparing against ${kind} ${targetLabel}${detected} - click to change`;
    }

    async setTargetBranch() {
        const ctx = this.getActiveRepo();
        if (!ctx || !(await this.isRepo(ctx))) {
            vscode.window.showErrorMessage('No git repository found');
            return;
        }

        try {
            // Get all local branches
            const branchNames = await ctx.git.localBranches();

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
        const ctx = this.getActiveRepo();
        if (!ctx) {
            vscode.window.showErrorMessage('No git repository found');
            return;
        }

        try {
            if (!(await this.isRepo(ctx))) {
                vscode.window.showErrorMessage(`Directory ${ctx.root} is not a git repository`);
                return;
            }

            const currentBranch = await ctx.git.currentBranch();
            const branchNames = await ctx.git.localBranches();
            const activeEditor = vscode.window.activeTextEditor;
            const targetBranch = await this.targetBranchFor(ctx);

            let debugInfo = `**PR Gutter Debug Info**\n\n`;
            debugInfo += `Repository root: ${ctx.root}\n`;
            debugInfo += `Current branch: ${currentBranch ?? '(detached HEAD)'}\n`;
            debugInfo += `Target branch: ${targetBranch}${this.targetBranchSetting ? '' : ' (auto-detected)'}\n`;
            debugInfo += `Local branches: ${branchNames.join(', ')}\n`;

            if (activeEditor) {
                const filePath = activeEditor.document.fileName;
                const relativePath = path.relative(ctx.root, filePath);
                debugInfo += `Active file: ${relativePath}\n`;

                // Test diff command with more specific logging
                try {
                    const base = await this.resolveDiffBase(ctx);
                    debugInfo += `Diff base: ${base ?? 'unresolved'}\n`;
                    const diffResult = base ? await ctx.git.diffFile(base, relativePath) : '';
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
                        debugInfo += `No differences found between ${targetBranch} and the working tree for this file.\n`;
                    }
                } catch (error) {
                    debugInfo += `Diff error: ${error}\n`;
                }
            } else {
                debugInfo += `No active editor\n`;
            }

            // Show in a single, reused output channel
            if (!this.debugChannel) {
                this.debugChannel = vscode.window.createOutputChannel('PR Gutter Debug');
            }
            this.debugChannel.clear();
            this.debugChannel.append(debugInfo);
            this.debugChannel.show();

        } catch (error) {
            vscode.window.showErrorMessage(`Debug info error: ${error}`);
        }
    }

    private clearEditor(editor: vscode.TextEditor) {
        editor.setDecorations(this.addedSingleLineDecorationType, []);
        editor.setDecorations(this.addedFirstLineDecorationType, []);
        editor.setDecorations(this.addedMiddleLineDecorationType, []);
        editor.setDecorations(this.addedLastLineDecorationType, []);
        editor.setDecorations(this.modifiedSingleLineDecorationType, []);
        editor.setDecorations(this.modifiedFirstLineDecorationType, []);
        editor.setDecorations(this.modifiedMiddleLineDecorationType, []);
        editor.setDecorations(this.modifiedLastLineDecorationType, []);
        editor.setDecorations(this.deletedDecorationType, []);
    }

    private async updateDecorationsForEditor(editor: vscode.TextEditor) {
        const document = editor.document;
        const ctx = this.getRepoForDocument(document);
        if (!ctx || !(await this.isRepo(ctx))) {
            return;
        }

        const relativePath = path.relative(ctx.root, document.fileName);
        this.trace(`updating decorations for ${relativePath}`);

        try {
            const base = await this.resolveDiffBase(ctx);
            if (!base) {
                this.clearEditor(editor);
                return;
            }

            let diffResult: string;
            if (document.isDirty) {
                // Unsaved changes: diff the live buffer against the baseline
                diffResult = await this.diffBuffer(ctx, base, relativePath, document.getText());
                this.trace(`live-diffed unsaved buffer against ${base.substring(0, 7)} for ${relativePath}`);
            } else {
                diffResult = await ctx.git.diffFile(base, relativePath);
                this.trace(`diffed working tree against ${base.substring(0, 7)} for ${relativePath}`);
            }

            const changes = parseDiff(diffResult);
            this.trace(`found ${changes.length} changes in ${relativePath}`);

            const targetLabel = this.targetCommit
                ? this.targetCommit.substring(0, 7)
                : await this.targetBranchFor(ctx);
            this.applyDecorations(editor, changes, targetLabel);
        } catch (error) {
            this.info(`error getting diff for ${relativePath}: ${error}`);
            // Clear decorations on error
            this.clearEditor(editor);
        }
    }

    private applyDecorations(editor: vscode.TextEditor, changes: DiffChange[], targetLabel: string) {
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
                            hoverMessage: this.getHoverMessage(change.type, startLine, endLine, targetLabel)
                        });
                    } else {
                        // Multi-line addition - apply different borders to first, middle, and last lines
                        for (let line = startLine; line <= endLine; line++) {
                            const range = new vscode.Range(line, 0, line, 0);
                            const decoration = {
                                range,
                                hoverMessage: this.getHoverMessage(change.type, startLine, endLine, targetLabel)
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
                        hoverMessage: this.getHoverMessage(change.type, startLine, endLine, targetLabel)
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
                            hoverMessage: this.getHoverMessage(change.type, startLine, endLine, targetLabel)
                        });
                    } else {
                        // Multi-line modified - apply different borders to first, middle, and last lines
                        for (let line = startLine; line <= endLine; line++) {
                            const range = new vscode.Range(line, 0, line, 0);
                            const decoration = {
                                range,
                                hoverMessage: this.getHoverMessage(change.type, startLine, endLine, targetLabel)
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
                        hoverMessage: this.getHoverMessage(change.type, startLine, endLine, targetLabel)
                    });
                }
            } else if (change.type === 'deleted') {
                // Handle deleted lines
                const range = new vscode.Range(startLine, 0, endLine, 0);
                deletedDecorations.push({
                    range,
                    hoverMessage: this.getHoverMessage(change.type, startLine, endLine, targetLabel)
                });
            }
        }

        editor.setDecorations(this.addedSingleLineDecorationType, addedSingleLineDecorations);
        editor.setDecorations(this.addedFirstLineDecorationType, addedFirstLineDecorations);
        editor.setDecorations(this.addedMiddleLineDecorationType, addedMiddleLineDecorations);
        editor.setDecorations(this.addedLastLineDecorationType, addedLastLineDecorations);
        editor.setDecorations(this.modifiedSingleLineDecorationType, modifiedSingleLineDecorations);
        editor.setDecorations(this.modifiedFirstLineDecorationType, modifiedFirstLineDecorations);
        editor.setDecorations(this.modifiedMiddleLineDecorationType, modifiedMiddleLineDecorations);
        editor.setDecorations(this.modifiedLastLineDecorationType, modifiedLastLineDecorations);
        editor.setDecorations(this.deletedDecorationType, deletedDecorations);

        // Reflect the active file's change counts in the status bar
        if (editor === vscode.window.activeTextEditor) {
            let addedLines = 0;
            let modifiedLines = 0;
            let deletedGroups = 0;
            for (const change of changes) {
                const lineCount = change.endLine - change.startLine + 1;
                if (change.type === 'added') {
                    addedLines += lineCount;
                } else if (change.type === 'modified') {
                    modifiedLines += lineCount;
                } else {
                    deletedGroups += 1;
                }
            }
            this.updateStatusBar(targetLabel, { added: addedLines, modified: modifiedLines, deleted: deletedGroups });
        }
    }

    private getHoverMessage(type: 'added' | 'modified' | 'deleted', startLine: number, endLine: number, target: string): string {
        const lineText = startLine === endLine ? `line ${startLine + 1}` : `lines ${startLine + 1}-${endLine + 1}`;

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
