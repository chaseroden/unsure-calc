// Statistics over sorted samples, matching numpy closely enough that the
// histogram's band edges come out bit-for-bit the same as in timecalc.py.

// np.percentile with the default 'linear' method, including numpy's _lerp,
// which interpolates from whichever neighbour is closer.
export function percentile(sorted, p) {
    const n = sorted.length;
    const virtual = (n - 1) * (p / 100);
    const lo = Math.floor(virtual);
    const hi = Math.min(lo + 1, n - 1);
    const t = virtual - lo;
    const a = sorted[lo];
    const b = sorted[hi];
    const diff = b - a;
    return t >= 0.5 ? b - diff * (1 - t) : a + diff * t;
}

// np.median: the middle element, or the mean of the middle two.
export function median(sorted) {
    const n = sorted.length;
    const mid = n >> 1;
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// np.searchsorted(sorted, x, side='left'): how many samples are < x.
export function searchLeft(sorted, x) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

export const PERCENTILES = [5, 10, 25, 50, 75, 90, 95];

export function summarize(sorted) {
    const n = sorted.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i++) sq += (sorted[i] - mean) ** 2;
    const percentiles = {};
    for (const p of PERCENTILES) percentiles[p] = percentile(sorted, p);
    return {
        n,
        mean,
        median: median(sorted),
        std: Math.sqrt(sq / n),
        min: sorted[0],
        max: sorted[n - 1],
        percentiles,
    };
}

// path_medians: [median, share] for each '|' path, sorted by median.
export function pathMedians(samples, pathIds) {
    // Path ids are dense (0, 1, 2, ... in order of first appearance).
    const counts = [];
    for (let i = 0; i < pathIds.length; i++) counts[pathIds[i]] = (counts[pathIds[i]] ?? 0) + 1;
    const groups = counts.map((c) => new Float64Array(c));
    const fill = new Array(counts.length).fill(0);
    for (let i = 0; i < samples.length; i++) groups[pathIds[i]][fill[pathIds[i]]++] = samples[i];
    return groups
        .map((g) => [median(g.sort()), g.length / samples.length])
        .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}
