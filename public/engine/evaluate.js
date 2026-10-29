// Port of evaluate() in reference/complete_calculator_time.py.

import { parse, isStochastic, repr } from './parse.js';
import { sample, constantValue, hashSeed } from './sample.js';
import { summarize, pathMedians } from './stats.js';

export class EvalError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EvalError';
    }
}

// Returns, for a constant expression:
//   { kind, constant: true, value, ast }
// and otherwise:
//   { kind, constant: false, n, mean, median, std, min, max, percentiles,
//     pathMedians, sorted, ast }
// kind is 'time' | 'duration' | 'number' (see parse). sorted holds every
// sample in ascending order; pathMedians is null unless the expression has '|'.
export function evaluate(expr, { samples = 100_000, seed = null } = {}) {
    const { ast, kind, canonical } = parse(expr);

    if (!isStochastic(ast)) {
        const value = constantValue(ast);
        if (!Number.isFinite(value)) throw new EvalError(notFinite(value));
        return { kind, constant: true, value, ast: repr(ast) };
    }

    const drawn = sample(ast, samples, seed ?? hashSeed(`${canonical}#${samples}`));
    const sorted = drawn.samples.slice().sort();
    // NaN sorts last, ±Infinity to the ends, so checking the ends is enough.
    if (!Number.isFinite(sorted[0]) || !Number.isFinite(sorted[samples - 1])) {
        throw new EvalError(notFinite(Number.isFinite(sorted[0]) ? sorted[samples - 1] : sorted[0]));
    }

    return {
        kind,
        constant: false,
        ...summarize(sorted),
        pathMedians: drawn.pathIds ? pathMedians(drawn.samples, drawn.pathIds) : null,
        sorted,
        ast: repr(ast),
    };
}

function notFinite(v) {
    return Number.isNaN(v)
        ? 'Result is not a number (e.g. a fractional power of a negative)'
        : 'Result is infinite (division by zero?)';
}
