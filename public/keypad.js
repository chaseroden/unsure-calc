// The on-screen keypad: its layout, and what each key does to the expression.
// Keys act on { text, start, end } (the input's value and selection) and
// return the new state, or null when the key does not apply where the caret
// is. Pure functions, so the editing rules are unit-tested in node.

// Shape glyphs for the distribution keys, drawn in a 24x14 box.
export const GLYPHS = {
    uniform: 'M2 12V4h20v8',
    normal: 'M1 12c5 0 7-10 11-10s6 10 11 10',
    left: 'M1 12c2 0 3-10 6-10 4 0 9 9 16 10',
    right: 'M23 12c-2 0-3-10-6-10-4 0-9 9-16 10',
    either: 'M1 12c2 0 3-8 5-8s2.5 8 6 8 3.5-8 6-8 3 8 5 8',
};

// Rows of keys. `key` is what applyKey dispatches on; `long` is the key a
// long press sends instead.
export const LAYOUT = [
    [
        { key: '~', label: '~', glyph: 'uniform', aria: 'uniform range', cls: 'dist' },
        { key: '~~', label: '~~', glyph: 'normal', aria: 'normal range', cls: 'dist' },
        { key: '<~', label: '<~', glyph: 'left', aria: 'range skewed low', cls: 'dist' },
        { key: '~>', label: '~>', glyph: 'right', aria: 'range skewed high', cls: 'dist' },
        { key: '|', label: '|', glyph: 'either', aria: 'either or', cls: 'dist' },
    ],
    [
        { key: 'h', label: 'h', aria: 'hours', cls: 'unit' },
        { key: 'm', label: 'm', aria: 'minutes', cls: 'unit' },
        { key: ':', label: ':', aria: 'colon', cls: 'unit' },
        { key: '(', label: '(', aria: 'open bracket', cls: 'op' },
        { key: ')', label: ')', aria: 'close bracket', cls: 'op' },
    ],
    [
        { key: '7', label: '7' },
        { key: '8', label: '8' },
        { key: '9', label: '9' },
        { key: '/', label: '÷', aria: 'divide', cls: 'op' },
        { key: 'back', label: '⌫', aria: 'backspace (hold to clear)', cls: 'fn', long: 'clear' },
    ],
    [
        { key: '4', label: '4' },
        { key: '5', label: '5' },
        { key: '6', label: '6' },
        { key: '*', label: '×', aria: 'multiply (hold for power)', cls: 'op', long: '^', hint: '^' },
        { key: 'clear', label: 'AC', aria: 'clear', cls: 'fn' },
    ],
    [
        { key: '1', label: '1' },
        { key: '2', label: '2' },
        { key: '3', label: '3' },
        { key: '-', label: '−', aria: 'minus', cls: 'op' },
        { key: 'now', label: 'now', aria: 'insert the current time', cls: 'unit' },
    ],
    [
        { key: '0', label: '0' },
        { key: '.', label: '.', aria: 'point' },
        { key: 'ampm', label: 'am/pm', aria: 'cycle am, pm', cls: 'unit' },
        { key: '+', label: '+', aria: 'plus', cls: 'op' },
        { key: '=', label: '=', aria: 'show result', cls: 'eq' },
    ],
];

const DIST_OPS = ['~~', '<~', '~>', '~'];
const BINARY_OPS = ['+', '-', '*', '/', '^'];

// The text just left of the caret ends a value: a digit, a unit, a ')'.
const endsOperand = (s) => /[\d.hm)]$/i.test(s);

function insert(state, str, before = state.text.slice(0, state.start)) {
    const text = before + str + state.text.slice(state.end);
    const caret = before.length + str.length;
    return { text, start: caret, end: caret };
}

export function applyKey(state, key, { h12 = false, now = new Date() } = {}) {
    const before = state.text.slice(0, state.start);
    const trimmed = before.trimEnd();
    const collapsed = state.start === state.end;

    if (DIST_OPS.includes(key)) {
        // Right after another distribution operator, swap it: one tap changes shape.
        const m = /(~~|<~|~>|~)\s*$/.exec(before);
        if (m && collapsed) return insert(state, key, before.slice(0, m.index));
        if (!endsOperand(trimmed)) return null;
        return insert(state, key, trimmed);
    }

    if (key === '|') {
        if (!endsOperand(trimmed)) return null;
        return insert(state, '|', trimmed);
    }

    if (BINARY_OPS.includes(key)) {
        if (endsOperand(trimmed)) return insert(state, ` ${key} `, trimmed);
        // A minus with no value before it is a sign: "-5~5", "10 * -2".
        if (key === '-') return /-$/.test(trimmed) ? null : insert(state, '-');
        // Another operator right after one replaces it.
        if (BINARY_OPS.includes(trimmed.at(-1))) {
            return insert(state, ` ${key} `, trimmed.slice(0, -1).trimEnd());
        }
        return null;
    }

    if (key === 'ampm') {
        // Cycle the suffix on the time just left of the caret: none, am, pm.
        const m = /(\d{1,2}(?::\d{2})?)(\s*([ap]m))?$/i.exec(before);
        if (!m || /[\d.:h]/i.test(before[m.index - 1] ?? '')) return null;
        const suffix = m[3]?.toLowerCase();
        const next = !suffix ? 'am' : suffix === 'am' ? 'pm' : '';
        return insert(state, m[1] + next, before.slice(0, m.index));
    }

    if (key === 'now') {
        const h = now.getHours();
        const mm = String(now.getMinutes()).padStart(2, '0');
        const str = h12 ? `${h % 12 || 12}:${mm}${h < 12 ? 'am' : 'pm'}` : `${String(h).padStart(2, '0')}:${mm}`;
        return insert(state, str);
    }

    if (key === 'back') {
        if (!collapsed) return insert(state, '');
        if (state.start === 0) return null;
        // Remove whole operators and am/pm, so " + " or "~~" never goes
        // half-deleted. (No lookbehind: older Safari cannot parse one.)
        const op = / [+\-*/^] $|~~$|<~$|~>$/.exec(before);
        const meridiem = /\d\s*([ap]m)$/i.exec(before);
        const cut = op ? op[0].length : meridiem ? meridiem[1].length : 1;
        return insert(state, '', before.slice(0, -cut));
    }

    if (key === 'clear') return { text: '', start: 0, end: 0 };

    // Digits, '.', units, brackets: as typed.
    return insert(state, key);
}
