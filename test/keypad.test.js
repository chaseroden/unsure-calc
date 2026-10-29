import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyKey } from '../public/keypad.js';
import { parse } from '../public/engine/parse.js';

// Type a sequence of keys into an empty (or given) expression.
function press(keys, text = '', opts = {}) {
    let state = { text, start: text.length, end: text.length };
    for (const k of keys) state = applyKey(state, k, opts) ?? state;
    return state.text;
}

test('typing a time calculation', () => {
    const t = press(['1', '7', ':', '3', '0', '-', '1', '5', 'm', '~', '3', '0', 'm', '-', '5', 'm', '~~', '1', '0', 'm']);
    assert.equal(t, '17:30 - 15m~30m - 5m~~10m');
    parse(t);
});

test('a distribution key swaps the previous one', () => {
    assert.equal(press(['1', '0', '~', '~~', '<~', '~>']), '10~>');
    assert.equal(press(['1', '0', '~', '~~', '2', '0']), '10~~20');
});

test('distribution keys need a value on their left', () => {
    assert.equal(press(['~']), '');
    assert.equal(press(['1', '+', '~']), '1 + ');
    assert.equal(press(['(', '|']), '(');
});

test('operators replace operators, minus becomes a sign', () => {
    assert.equal(press(['5', '+', '*']), '5 * ');
    assert.equal(press(['-', '5', '~', '5']), '-5~5');
    assert.equal(press(['1', '0', '*', '-', '2']), '10 * -2');
    assert.equal(press(['1', '0', '*', '-', '-']), '10 * -');
    assert.equal(press(['*']), '');
    assert.equal(press(['5', '~', '*']), '5~');
});

test('am/pm cycles the time left of the caret', () => {
    assert.equal(press(['ampm'], '5:30'), '5:30am');
    assert.equal(press(['ampm', 'ampm'], '5:30'), '5:30pm');
    assert.equal(press(['ampm', 'ampm', 'ampm'], '5:30'), '5:30');
    assert.equal(press(['ampm'], '12 - 5'), '12 - 5am');
    assert.equal(press(['ampm'], '1h15'), '1h15');
    assert.equal(press(['ampm'], '100'), '100');
    assert.equal(press(['ampm'], '15m'), '15m');
    parse(press(['ampm', 'ampm'], '5:30'));
});

test('now inserts the current time', () => {
    const now = new Date(2026, 0, 1, 17, 5);
    assert.equal(press(['now'], '', { now }), '17:05');
    assert.equal(press(['now'], '', { now, h12: true }), '5:05pm');
    assert.equal(press(['now'], '', { now: new Date(2026, 0, 1, 0, 9), h12: true }), '12:09am');
});

test('backspace removes whole operators', () => {
    assert.equal(press(['back'], '5 + '), '5');
    assert.equal(press(['back'], '10~~'), '10');
    assert.equal(press(['back'], '10~'), '10');
    assert.equal(press(['back'], '5:30pm'), '5:30');
    assert.equal(press(['back'], '15m'), '15');
    assert.equal(press(['back'], ''), '');
});

test('keys act at the caret and replace a selection', () => {
    assert.equal(applyKey({ text: '10 + 5', start: 2, end: 2 }, '~').text, '10~ + 5');
    assert.deepEqual(applyKey({ text: '10 + 5', start: 5, end: 6 }, '7'), { text: '10 + 7', start: 6, end: 6 });
    assert.deepEqual(applyKey({ text: '10 + 5', start: 0, end: 6 }, 'back'), { text: '', start: 0, end: 0 });
});
