import { describe, expect, it } from 'vitest';
import { mergeConsecutiveChanges, parseDiff } from './diffParser';

function hunk(header: string, ...body: string[]): string {
    return [header, ...body].join('\n') + '\n';
}

describe('parseDiff', () => {
    it('returns no changes for an empty diff', () => {
        expect(parseDiff('')).toEqual([]);
        expect(parseDiff('   \n')).toEqual([]);
    });

    it('reports pure additions as added', () => {
        const diff = hunk(
            '@@ -10,2 +10,4 @@',
            ' context',
            '+new line one',
            '+new line two',
            ' context'
        );
        expect(parseDiff(diff)).toEqual([
            { startLine: 10, endLine: 11, type: 'added' }
        ]);
    });

    it('reports a pure deletion as a single deleted marker', () => {
        const diff = hunk(
            '@@ -5,4 +5,2 @@',
            ' context',
            '-gone one',
            '-gone two',
            ' context'
        );
        // Two removed lines produce ONE marker anchored where they used to be
        expect(parseDiff(diff)).toEqual([
            { startLine: 5, endLine: 5, type: 'deleted' }
        ]);
    });

    it('reports paired -/+ runs as modified', () => {
        const diff = hunk(
            '@@ -1,3 +1,3 @@',
            ' context',
            '-old text',
            '+new text',
            ' context'
        );
        expect(parseDiff(diff)).toEqual([
            { startLine: 1, endLine: 1, type: 'modified' }
        ]);
    });

    it('splits a group with more additions than deletions into modified + added', () => {
        const diff = hunk(
            '@@ -1,3 +1,5 @@',
            ' context',
            '-old',
            '+changed',
            '+extra one',
            '+extra two',
            ' context'
        );
        expect(parseDiff(diff)).toEqual([
            { startLine: 1, endLine: 1, type: 'modified' },
            { startLine: 2, endLine: 3, type: 'added' }
        ]);
    });

    it('splits a group with more deletions than additions into modified + deleted', () => {
        const diff = hunk(
            '@@ -1,5 +1,3 @@',
            ' context',
            '-old one',
            '-old two',
            '-old three',
            '+changed',
            ' context'
        );
        expect(parseDiff(diff)).toEqual([
            { startLine: 1, endLine: 1, type: 'modified' },
            { startLine: 2, endLine: 2, type: 'deleted' }
        ]);
    });

    it('handles multiple hunks with 0-based line numbers', () => {
        const diff =
            hunk(
                '@@ -1,2 +1,3 @@',
                ' context',
                '+added at top'
            ) +
            hunk(
                '@@ -20,3 +21,3 @@',
                ' context',
                '-before',
                '+after',
                ' context'
            );
        expect(parseDiff(diff)).toEqual([
            { startLine: 1, endLine: 1, type: 'added' },
            { startLine: 21, endLine: 21, type: 'modified' }
        ]);
    });

    it('handles a change group at the very end of the diff', () => {
        const diff = hunk(
            '@@ -8,2 +8,2 @@',
            ' context',
            '-old tail',
            '+new tail'
        );
        expect(parseDiff(diff)).toEqual([
            { startLine: 8, endLine: 8, type: 'modified' }
        ]);
    });

    it('ignores "no newline at end of file" markers inside a group', () => {
        const diff = hunk(
            '@@ -1,2 +1,2 @@',
            ' context',
            '-old',
            '\\ No newline at end of file',
            '+new',
            '\\ No newline at end of file'
        );
        expect(parseDiff(diff)).toEqual([
            { startLine: 1, endLine: 1, type: 'modified' }
        ]);
    });

    it('ignores file headers and content outside hunks', () => {
        const diff = [
            'diff --git a/foo.txt b/foo.txt',
            'index 1234567..89abcde 100644',
            '--- a/foo.txt',
            '+++ b/foo.txt',
            '@@ -1,1 +1,2 @@',
            ' context',
            '+added'
        ].join('\n') + '\n';
        expect(parseDiff(diff)).toEqual([
            { startLine: 1, endLine: 1, type: 'added' }
        ]);
    });

    it('merges consecutive same-type lines into ranges', () => {
        const diff = hunk(
            '@@ -1,2 +1,6 @@',
            ' context',
            '+one',
            '+two',
            '+three',
            '+four',
            ' context'
        );
        expect(parseDiff(diff)).toEqual([
            { startLine: 1, endLine: 4, type: 'added' }
        ]);
    });
});

describe('mergeConsecutiveChanges', () => {
    it('merges adjacent same-type changes', () => {
        expect(mergeConsecutiveChanges([
            { startLine: 1, endLine: 1, type: 'added' },
            { startLine: 2, endLine: 2, type: 'added' },
            { startLine: 4, endLine: 4, type: 'added' }
        ])).toEqual([
            { startLine: 1, endLine: 2, type: 'added' },
            { startLine: 4, endLine: 4, type: 'added' }
        ]);
    });

    it('does not merge different types', () => {
        expect(mergeConsecutiveChanges([
            { startLine: 1, endLine: 1, type: 'modified' },
            { startLine: 2, endLine: 2, type: 'added' }
        ])).toEqual([
            { startLine: 1, endLine: 1, type: 'modified' },
            { startLine: 2, endLine: 2, type: 'added' }
        ]);
    });

    it('does not mutate its input', () => {
        const input = [
            { startLine: 1, endLine: 1, type: 'added' as const },
            { startLine: 2, endLine: 2, type: 'added' as const }
        ];
        mergeConsecutiveChanges(input);
        expect(input[0].endLine).toBe(1);
    });

    it('handles empty input', () => {
        expect(mergeConsecutiveChanges([])).toEqual([]);
    });
});
