// Runs the Monte Carlo off the main thread. One message in, one out; the
// caller drops replies to anything but its latest job id.

import { evaluate } from './engine/evaluate.js';

self.onmessage = ({ data: { id, expr, samples } }) => {
    try {
        const result = evaluate(expr, { samples });
        self.postMessage({ id, result }, result.sorted ? [result.sorted.buffer] : []);
    } catch (e) {
        self.postMessage({ id, error: { message: e.message, pos: e.pos ?? null, end: e.end ?? null } });
    }
};
