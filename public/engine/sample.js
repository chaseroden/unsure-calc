// Monte Carlo sampling. Port of the emit() methods and sample_with_paths in
// reference/complete_calculator.py, on a seeded PRNG so the same expression
// always produces the same samples (results do not flicker while typing, and
// a shared link reproduces exactly).

// cyrb53-style string hash, folded to 32 bits.
export function hashSeed(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
}

// xoshiro128**, seeded through splitmix32. Returns floats in [0, 1).
export function makeRng(seed) {
    let s = seed >>> 0;
    const split = () => {
        s = (s + 0x9e3779b9) >>> 0;
        let z = s;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
        return (z ^ (z >>> 16)) >>> 0;
    };
    let a = split(), b = split(), c = split(), d = split();
    return () => {
        const r = Math.imul(rotl(Math.imul(b, 5), 7), 9);
        const t = b << 9;
        c ^= a;
        d ^= b;
        b ^= c;
        a ^= d;
        c ^= t;
        d = rotl(d, 11);
        return (r >>> 0) / 4294967296;
    };
}

function rotl(x, k) {
    return (x << k) | (x >>> (32 - k));
}

// Every '|' node in the tree, in the same order as find_mixtures.
function findMixtures(node, out = []) {
    if (node.type === 'mix') {
        out.push(node);
        node.branches.forEach((b) => findMixtures(b, out));
    } else if (node.type === 'bin') {
        findMixtures(node.left, out);
        findMixtures(node.right, out);
    }
    return out;
}

// Turns the AST into a closure that draws one sample per call. choices[k] is
// set to the branch the k-th mixture picked, as Mixture.choice is in Python.
function compile(node, rng, mixIndex, choices) {
    switch (node.type) {
        case 'num': {
            const v = node.value;
            return () => v;
        }
        case 'dist': {
            const { min, max } = node;
            const range = max - min;
            switch (node.shape) {
                case 'uniform':
                    return () => min + range * rng();
                case 'normal': {
                    // ±2σ covers the range, as NormalRange does.
                    const mean = (min + max) / 2;
                    const sd = range / 4;
                    const gauss = makeGauss(rng);
                    return () => mean + sd * gauss();
                }
                case 'left':
                    return () => min + range * beta25(rng);
                case 'right':
                    return () => min + range * (1 - beta25(rng));
            }
            break;
        }
        case 'mix': {
            const k = mixIndex.get(node);
            const fns = node.branches.map((b) => compile(b, rng, mixIndex, choices));
            const n = fns.length;
            return () => {
                const c = Math.floor(rng() * n);
                choices[k] = c;
                return fns[c]();
            };
        }
        case 'bin': {
            const l = compile(node.left, rng, mixIndex, choices);
            const r = compile(node.right, rng, mixIndex, choices);
            switch (node.op) {
                case '+': return () => l() + r();
                case '-': return () => l() - r();
                case '*': return () => l() * r();
                case '/': return () => l() / r();
                case '^': return () => l() ** r();
            }
        }
    }
    throw new Error(`cannot compile ${node.type}`);
}

// Box-Muller, keeping the second value of each pair.
function makeGauss(rng) {
    let spare = null;
    return () => {
        if (spare !== null) {
            const s = spare;
            spare = null;
            return s;
        }
        const u = 1 - rng(); // (0, 1], so log never sees 0
        const v = rng();
        const r = Math.sqrt(-2 * Math.log(u));
        spare = r * Math.sin(2 * Math.PI * v);
        return r * Math.cos(2 * Math.PI * v);
    };
}

// Beta(2, 5) is the 2nd smallest of 6 uniforms; 1 - Beta(2, 5) is Beta(5, 2).
function beta25(rng) {
    let lo = rng();
    let hi = rng();
    if (hi < lo) [lo, hi] = [hi, lo];
    for (let i = 0; i < 4; i++) {
        const u = rng();
        if (u < lo) {
            hi = lo;
            lo = u;
        } else if (u < hi) {
            hi = u;
        }
    }
    return hi;
}

// Evaluates an AST with no distributions in it.
export function constantValue(ast) {
    return compile(ast, null, new Map(), [])();
}

// sample_with_paths: returns { samples, pathIds }. pathIds gives, per sample,
// an id for the combination of branches every '|' picked (null without '|').
export function sample(ast, n, seed) {
    const rng = makeRng(seed);
    const mixtures = findMixtures(ast);
    const mixIndex = new Map(mixtures.map((m, k) => [m, k]));
    const choices = new Int32Array(mixtures.length);
    const draw = compile(ast, rng, mixIndex, choices);
    const samples = new Float64Array(n);

    if (mixtures.length === 0) {
        for (let i = 0; i < n; i++) samples[i] = draw();
        return { samples, pathIds: null };
    }

    // A path's key reads the choices as digits of a mixed-radix number (each
    // mixture contributes choice + 1, so "not reached" is 0), falling back to
    // a string when there are too many combinations for an exact float.
    const radices = [];
    let span = 1;
    for (const m of mixtures) {
        radices.push(span);
        span *= m.branches.length + 1;
    }
    const pathKey =
        span <= Number.MAX_SAFE_INTEGER
            ? () => {
                  let key = 0;
                  for (let k = 0; k < choices.length; k++) key += (choices[k] + 1) * radices[k];
                  return key;
              }
            : () => choices.join(',');

    const pathIds = new Int32Array(n);
    const ids = new Map();
    for (let i = 0; i < n; i++) {
        // Reset so nested mixtures that weren't reached this sample read -1.
        choices.fill(-1);
        samples[i] = draw();
        const key = pathKey();
        let id = ids.get(key);
        if (id === undefined) {
            id = ids.size;
            ids.set(key, id);
        }
        pathIds[i] = id;
    }
    return { samples, pathIds };
}
