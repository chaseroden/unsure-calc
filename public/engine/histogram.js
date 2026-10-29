// Histogram banding. Port of create_histogram in reference/timecalc.py, split
// into the numbers (buildHistogram), the rows a UI draws (histogramRows), and
// the CLI's text rendering (histogramText), which matches timecalc.py exactly.

import { percentile, searchLeft } from './stats.js';

const MAX_SIZE = 30; // the CLI's widest bar, in characters

// sorted: ascending samples. bands: null for auto, else the requested count.
// medians: values to mark (the overall median, or one per '|' path).
export function buildHistogram(sorted, { bands = null, collapseGaps = false, medians = [] } = {}) {
    const n = sorted.length;
    // 2nd-98th percentile, so outliers don't stretch the range.
    const lower = percentile(sorted, 2);
    const upper = percentile(sorted, 98);
    const countBelow = searchLeft(sorted, lower);
    const countAbove = n - searchLeft(sorted, upper);

    // Samples in each of k equal bands, as [start, end) intervals.
    const bandCounts = (k) => {
        const width = (upper - lower) / k;
        const counts = new Array(k);
        let prev = searchLeft(sorted, lower);
        for (let i = 1; i <= k; i++) {
            const next = searchLeft(sorted, lower + width * i);
            counts[i - 1] = next - prev;
            prev = next;
        }
        return counts;
    };

    const barLengthsFor = (counts) => {
        const maxCount = Math.max(...counts, countAbove, countBelow);
        return counts.map((c) => (maxCount === 0 ? 0 : Math.trunc((c / maxCount) * MAX_SIZE)));
    };

    const displayedBands = (k) => {
        let shown = k;
        for (const [i, j] of collapsedRuns(barLengthsFor(bandCounts(k)))) shown -= j - i;
        return shown;
    };

    // Largest band count where above/below hold no more samples than the
    // top/bottom real bands (beyond that, the tails look fatter than the
    // distribution's own edges).
    const autoBands = (maxAuto = 50, fallback = 21) => {
        let best = null;
        for (let k = 2; k <= maxAuto; k++) {
            const counts = bandCounts(k);
            if (counts[0] < countBelow || counts[k - 1] < countAbove) break;
            best = k;
        }
        return best ?? fallback;
    };

    const auto = bands === null;
    let nBands = auto ? autoBands() : bands;

    // With gaps collapsed, pick the band count whose *displayed* rows come
    // closest to the request (approximate: one more band can shift several rows).
    if (collapseGaps && !auto) {
        const target = bands;
        const maxBands = 20000;
        let bestN = target;
        let bestDiff = Math.abs(displayedBands(target) - target);
        let lo = target;
        let hi = null;
        let k = target;
        while (bestDiff && k < maxBands) {
            const shown = displayedBands(k);
            if (Math.abs(shown - target) < bestDiff) {
                bestN = k;
                bestDiff = Math.abs(shown - target);
            }
            if (shown >= target) {
                hi = k;
                break;
            }
            lo = k;
            // Jump proportionally to how much of the chart is being collapsed.
            k = Math.min(Math.max(k + 1, Math.floor((k * target) / Math.max(shown, 1))), maxBands);
        }
        // Narrow down between the last undershoot and the first overshoot.
        if (hi !== null) {
            while (hi - lo > 1) {
                const mid = Math.floor((lo + hi) / 2);
                const shown = displayedBands(mid);
                const diff = Math.abs(shown - target);
                if (diff < bestDiff || (diff === bestDiff && mid < bestN)) {
                    bestN = mid;
                    bestDiff = diff;
                }
                if (shown >= target) hi = mid;
                else lo = mid;
            }
        }
        nBands = bestN;
    }

    const counts = bandCounts(nBands);
    return {
        n,
        lower,
        upper,
        nBands,
        bandSize: (upper - lower) / nBands,
        counts,
        countBelow,
        countAbove,
        // above/below count toward the scale, so a huge tail visibly squashes
        // the in-range bands rather than overflowing.
        maxCount: Math.max(...counts, countAbove, countBelow),
        medians,
        collapseGaps,
    };
}

// [start, end) index pairs for runs of 2+ zero-length bars.
function* collapsedRuns(barLengths) {
    let i = 0;
    while (i < barLengths.length) {
        let j = i;
        while (j < barLengths.length && barLengths[j] === 0) j++;
        if (j - i >= 2) yield [i, j];
        i = Math.max(j, i + 1);
    }
}

// Rows top (highest values) to bottom, as the CLI prints them:
//   { kind: 'above' | 'band' | 'gap' | 'below', label, count, bar, medians,
//     start, end }
// bar is the CLI's character count (0-30); count/maxCount is the exact share.
// fmt(value, seconds) formats values; seconds switch on for every label when
// minute precision would repeat one.
export function histogramRows(h, fmt) {
    const centres = [];
    for (let i = 0; i < h.nBands; i++) centres.push(h.lower + i * h.bandSize + h.bandSize / 2);
    let labels = centres.map((v) => fmt(v, false));
    const useSeconds = labels.some((l, i) => i > 0 && l === labels[i - 1]);
    if (useSeconds) labels = centres.map((v) => fmt(v, true));

    const bar = (count) => (h.maxCount > 0 ? Math.trunc((count / h.maxCount) * MAX_SIZE) : 0);
    // Medians can fall outside the banded range (e.g. a spike at the 98th percentile).
    const rows = [
        {
            kind: 'above',
            label: 'above',
            count: h.countAbove,
            bar: bar(h.countAbove),
            medians: h.medians.filter((m) => m >= h.upper),
            start: h.upper,
            end: Infinity,
        },
    ];

    const bandRows = [];
    for (let i = h.nBands - 1; i >= 0; i--) {
        const start = h.lower + i * h.bandSize;
        const end = start + h.bandSize;
        bandRows.push({
            kind: 'band',
            label: labels[i],
            count: h.counts[i],
            bar: bar(h.counts[i]),
            medians: h.medians.filter((m) => start <= m && m < end),
            start,
            end,
        });
    }

    // Collapse runs of 2+ blank rows into a single marker row (a median
    // inside a collapsed run is carried on the marker).
    let i = 0;
    while (i < bandRows.length) {
        let j = i;
        while (h.collapseGaps && j < bandRows.length && bandRows[j].bar === 0) j++;
        if (j - i >= 2) {
            const run = bandRows.slice(i, j);
            rows.push({
                kind: 'gap',
                label: '...',
                count: run.reduce((s, r) => s + r.count, 0),
                bar: 0,
                medians: run.flatMap((r) => r.medians),
                start: run.at(-1).start,
                end: run[0].end,
            });
            i = j;
        } else {
            rows.push(bandRows[i]);
            i++;
        }
    }

    rows.push({
        kind: 'below',
        label: 'below',
        count: h.countBelow,
        bar: bar(h.countBelow),
        medians: h.medians.filter((m) => m < h.lower),
        start: -Infinity,
        end: h.lower,
    });

    return { rows, useSeconds, labelWidth: Math.max(10, ...labels.map((l) => l.length)) };
}

// The CLI's text histogram, character for character.
export function histogramText(h, fmt) {
    const { rows, useSeconds, labelWidth } = histogramRows(h, fmt);
    const fmtMedians = (ms) => ms.map((m) => fmt(m, useSeconds)).join(', ');
    let out = '\nHistogram:\n';
    for (const r of rows) {
        const label = r.label.padStart(labelWidth);
        if (r.kind === 'gap') {
            const trailing = r.medians.length ? ` (median ${fmtMedians(r.medians)})` : '';
            out += `${label} |${trailing}\n`;
        } else {
            const trailing = r.medians.length ? ` (${fmtMedians(r.medians)})` : '';
            out += `${label} | ${'▒'.repeat(r.bar)}${trailing}\n`;
        }
    }
    return out;
}
