/**
 * Thin promise-based wrapper around the git CLI. Replaces the simple-git
 * dependency: the extension only needs a handful of read-only commands, and
 * spawning git directly keeps the dependency tree empty and the bundle small.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 50 * 1024 * 1024;

export class GitCli {
    constructor(private readonly cwd: string) {}

    /** Run git with the given args; resolves with stdout, rejects on non-zero exit. */
    async run(args: string[]): Promise<string> {
        const { stdout } = await execFileAsync('git', args, { cwd: this.cwd, maxBuffer: MAX_BUFFER });
        return stdout;
    }

    /** Like run(), but treats the listed exit codes as success (returns stdout). */
    private async runTolerant(args: string[], okExitCodes: number[]): Promise<string> {
        try {
            return await this.run(args);
        } catch (error) {
            const e = error as { code?: unknown; stdout?: unknown };
            if (typeof e?.code === 'number' && okExitCodes.includes(e.code) && typeof e.stdout === 'string') {
                return e.stdout;
            }
            throw error;
        }
    }

    async isRepo(): Promise<boolean> {
        try {
            return (await this.run(['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
        } catch {
            return false;
        }
    }

    /** Current branch name, or undefined on detached HEAD / errors. */
    async currentBranch(): Promise<string | undefined> {
        try {
            const branch = (await this.run(['branch', '--show-current'])).trim();
            return branch || undefined;
        } catch {
            return undefined;
        }
    }

    /** Short names of all local branches. */
    async localBranches(): Promise<string[]> {
        const out = await this.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
        return out.split('\n').map(line => line.trim()).filter(Boolean);
    }

    /** Does a fully-qualified ref (e.g. refs/heads/main) exist? */
    async refExists(ref: string): Promise<boolean> {
        try {
            await this.run(['show-ref', '--verify', '--quiet', ref]);
            return true;
        } catch {
            return false;
        }
    }

    /** Resolve a symbolic ref (e.g. refs/remotes/origin/HEAD) to its short name, or undefined. */
    async symbolicRef(ref: string): Promise<string | undefined> {
        try {
            const value = (await this.run(['symbolic-ref', '--short', ref])).trim();
            return value || undefined;
        } catch {
            return undefined;
        }
    }

    /** Does the given revision resolve to a commit? */
    async isCommit(rev: string): Promise<boolean> {
        try {
            await this.run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
            return true;
        } catch {
            return false;
        }
    }

    /** Merge base of two revisions. Throws on disjoint histories / unborn HEAD. */
    async mergeBase(a: string, b: string): Promise<string> {
        return (await this.run(['merge-base', a, b])).trim();
    }

    /** Contents of a file at a revision (`git show rev:path`). Throws if absent. */
    async show(spec: string): Promise<string> {
        return this.run(['show', spec]);
    }

    /** Unified diff of the working tree file against a revision. */
    async diffFile(base: string, relativePath: string): Promise<string> {
        return this.run(['diff', base, '--', relativePath]);
    }

    /**
     * Diff two files on disk. git exits with code 1 when the files differ -
     * treated as success.
     */
    async diffNoIndex(fileA: string, fileB: string): Promise<string> {
        return this.runTolerant(['diff', '--no-index', '--', fileA, fileB], [1]);
    }
}
