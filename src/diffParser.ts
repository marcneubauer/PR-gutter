/**
 * Pure unified-diff parsing logic, extracted from the extension so it can be
 * unit tested without a VS Code host.
 */

export interface DiffChange {
    startLine: number;
    endLine: number;
    type: 'added' | 'modified' | 'deleted';
}

/**
 * Parse unified diff output into line changes (0-based line numbers in the
 * new file).
 *
 * Within a hunk, a run of `-` lines immediately followed by a run of `+`
 * lines is a *change group*: paired lines are reported as `modified`, excess
 * `+` lines as `added`, and excess `-` lines as a single `deleted` marker
 * anchored on the line that now follows the removed content.
 */
export function parseDiff(diffText: string): DiffChange[] {
    const changes: DiffChange[] = [];
    if (!diffText.trim()) {
        return changes;
    }

    const lines = diffText.split('\n');
    let currentNewLine = 0;
    let inHunk = false;

    // State for the current change group (run of -/+ lines)
    let groupStart = 0;
    let deleteCount = 0;
    let addCount = 0;

    const flushGroup = () => {
        if (deleteCount === 0 && addCount === 0) {
            return;
        }

        const paired = Math.min(deleteCount, addCount);
        for (let i = 0; i < paired; i++) {
            changes.push({ startLine: groupStart + i, endLine: groupStart + i, type: 'modified' });
        }
        for (let i = paired; i < addCount; i++) {
            changes.push({ startLine: groupStart + i, endLine: groupStart + i, type: 'added' });
        }
        if (deleteCount > addCount) {
            // Net deletion: one marker anchored where the removed lines used to be
            const anchor = groupStart + addCount;
            changes.push({ startLine: anchor, endLine: anchor, type: 'deleted' });
        }

        currentNewLine = groupStart + addCount;
        deleteCount = 0;
        addCount = 0;
    };

    for (const line of lines) {
        if (line.startsWith('@@')) {
            // Parse hunk header: @@ -old_start,old_count +new_start,new_count @@
            const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
            if (match) {
                flushGroup();
                currentNewLine = parseInt(match[1]) - 1; // VS Code uses 0-based line numbers
                inHunk = true;
            }
            continue;
        }

        if (!inHunk) {
            continue;
        }

        if (line.startsWith('+') && !line.startsWith('+++')) {
            if (deleteCount === 0 && addCount === 0) {
                groupStart = currentNewLine;
            }
            addCount++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            if (deleteCount === 0 && addCount === 0) {
                groupStart = currentNewLine;
            }
            deleteCount++;
        } else if (line.startsWith(' ')) {
            // Context line - ends any change group
            flushGroup();
            currentNewLine++;
        } else if (line.startsWith('\\')) {
            // "No newline at end of file" - ignore
            continue;
        } else {
            // File headers, mode lines, empty trailing line, etc.
            flushGroup();
        }
    }
    flushGroup();

    // Merge consecutive changes of the same type for better visualization
    return mergeConsecutiveChanges(changes);
}

export function mergeConsecutiveChanges(changes: DiffChange[]): DiffChange[] {
    if (changes.length === 0) {
        return changes;
    }

    const merged: DiffChange[] = [];
    let current = { ...changes[0] };

    for (let i = 1; i < changes.length; i++) {
        const next = changes[i];

        // Merge if same type and consecutive lines
        if (current.type === next.type && current.endLine + 1 === next.startLine) {
            current.endLine = next.endLine;
        } else {
            merged.push(current);
            current = { ...next };
        }
    }

    merged.push(current);
    return merged;
}
