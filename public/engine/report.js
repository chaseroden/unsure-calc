// The CLI's default text output (timecalc.py's format_result without -v,
// followed by create_histogram), for "Copy as text".

import { buildHistogram, histogramText } from './histogram.js';
import { formatterFor, pyFixed } from './format.js';
import { PERCENTILES } from './stats.js';

export function cliText(result, { h12 = false, bands = null, collapseGaps = false, perPath = false } = {}) {
    // Plain numbers print as %.2f (and %8.2f in the percentile column).
    const value = result.kind === 'number' ? (v) => pyFixed(v, 2) : formatterFor(result.kind, { h12 });
    const stat = result.kind === 'number' ? (v) => value(v).padStart(8) : value;

    if (result.constant) return `Result: ${value(result.value)}\n`;

    let out = 'Percentiles:\n';
    for (const p of PERCENTILES) {
        const v = stat(result.percentiles[p]);
        out += `  ${String(p).padStart(3)}%:  ${v}${p === 50 ? '  (median)' : ''}\n`;
    }
    const paths = perPath && result.pathMedians?.length > 0;
    if (paths && result.pathMedians.length > 1) {
        const parts = result.pathMedians.map(([m, share]) => `${value(m)} (${pyFixed(share * 100, 0)}%)`);
        out += `\n  Path medians:  ${parts.join(', ')}\n`;
    }

    const medians = paths ? result.pathMedians.map(([m]) => m) : [result.median];
    const h = buildHistogram(result.sorted, { bands, collapseGaps, medians });
    return out + '\n' + histogramText(h, formatterFor(result.kind, { h12, label: true }));
}
