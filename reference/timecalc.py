#!/usr/bin/env python3
"""
Time Calculator CLI

Usage:
    python timecalc.py "240 - 10~20 - 5~~10"
    python timecalc.py                        # Interactive mode
"""

import sys
import argparse
try:
    from complete_calculator_time import evaluate
    from time_support import format_time_result
    TIME_SUPPORT = True
except ImportError:
    from complete_calculator import evaluate
    TIME_SUPPORT = False


def format_result(result, verbose=False, show_percentiles=True, path_medians=False):
    """Format the evaluation result for display."""

    is_time = result.get('is_time', False)
    format_12h = result.get('format_12h', False)

    # Constants are always simple
    if result['type'] == 'constant':
        if is_time:
            value_str = format_time_result(result['value'], format_12h)
        else:
            value_str = f"{result['value']:.2f}"

        if verbose:
            return f"""Result: {value_str} (constant)
Expression: {result['expression']}
AST: {result['ast']}
"""
        else:
            return f"Result: {value_str}\n"

    # Stochastic result
    output = ""

    # Verbose section (shown only with -v flag)
    if verbose:
        output += f"Expression: {result['expression']}\n"
        output += f"AST: {result['ast']}\n\n"

        output += f"Statistics ({result['n_samples']:,} samples):\n"
        if is_time:
            output += f"  Mean:     {format_time_result(result['mean'], format_12h)}\n"
            output += f"  Median:   {format_time_result(result['median'], format_12h)}\n\n"
        else:
            output += f"  Mean:     {result['mean']:8.2f}\n"
            output += f"  Median:   {result['median']:8.2f}\n"
            output += f"  Std Dev:  {result['std']:8.2f}\n"
            output += f"  Min:      {result['min']:8.2f}\n"
            output += f"  Max:      {result['max']:8.2f}\n\n"

        output += "Confidence Intervals:\n"
        if is_time:
            output += f"  90% CI:  [{format_time_result(result['percentiles'][5], format_12h)}, {format_time_result(result['percentiles'][95], format_12h)}]\n"
            output += f"  80% CI:  [{format_time_result(result['percentiles'][10], format_12h)}, {format_time_result(result['percentiles'][90], format_12h)}]\n"
            output += f"  50% CI:  [{format_time_result(result['percentiles'][25], format_12h)}, {format_time_result(result['percentiles'][75], format_12h)}]\n\n"
        else:
            output += f"  90% CI:  [{result['percentiles'][5]:7.2f}, {result['percentiles'][95]:7.2f}]\n"
            output += f"  80% CI:  [{result['percentiles'][10]:7.2f}, {result['percentiles'][90]:7.2f}]\n"
            output += f"  50% CI:  [{result['percentiles'][25]:7.2f}, {result['percentiles'][75]:7.2f}]\n\n"

    # Percentiles section (shown unless -p flag)
    if show_percentiles:
        output += "Percentiles:\n"
        for p in [5, 10, 25, 50, 75, 90, 95]:
            if is_time:
                value_str = format_time_result(result['percentiles'][p], format_12h)
                if p == 50:
                    output += f"  {p:3d}%:  {value_str}  (median)\n"
                else:
                    output += f"  {p:3d}%:  {value_str}\n"
            else:
                if p == 50:
                    output += f"  {p:3d}%:  {result['percentiles'][p]:8.2f}  (median)\n"
                else:
                    output += f"  {p:3d}%:  {result['percentiles'][p]:8.2f}\n"

        if path_medians and len(result.get('path_medians', [])) > 1:
            parts = []
            for value, share in result['path_medians']:
                value_str = format_time_result(value, format_12h) if is_time else f"{value:.2f}"
                parts.append(f"{value_str} ({share:.0%})")
            output += f"\n  Path medians:  {', '.join(parts)}\n"

    return output


def create_histogram(result, n_bands=None, collapse_gaps=False, path_medians=False):
    """Create a text-based histogram matching the original unsure calculator style."""
    if result['type'] == 'constant':
        return ""

    samples = result['samples']
    # Medians to mark: one per '|' path with -m, otherwise the overall median
    if path_medians and result.get('path_medians'):
        medians = [m for m, _ in result['path_medians']]
    else:
        medians = [result['median']]
    is_time = result.get('is_time', False)
    format_12h = result.get('format_12h', False)
    np = __import__('numpy')

    # Calculate histogram bounds
    # Use percentiles to avoid outliers dominating the range
    lower_bound = np.percentile(samples, 2)
    upper_bound = np.percentile(samples, 98)
    sorted_samples = np.sort(samples)
    max_size = 30

    # Count samples outside bounds
    count_below = np.sum(samples < lower_bound)
    count_above = np.sum(samples >= upper_bound)

    def band_counts(n):
        """Count samples in each of n equal bands, as [start, end) intervals."""
        edges = lower_bound + (upper_bound - lower_bound) / n * np.arange(n + 1)
        return np.diff(np.searchsorted(sorted_samples, edges, side='left'))

    def collapsed_runs(bar_lengths):
        """Yield (start, end) index pairs for runs of 2+ blank bands."""
        i = 0
        while i < len(bar_lengths):
            j = i
            while j < len(bar_lengths) and bar_lengths[j] == 0:
                j += 1
            if j - i >= 2:
                yield i, j
            i = max(j, i + 1)

    def bar_lengths_for(counts):
        max_count = max(counts.max(), count_above, count_below)
        if max_count == 0:
            return np.zeros(len(counts), dtype=int)
        return (counts / max_count * max_size).astype(int)

    def displayed_bands(n):
        bar_lengths = bar_lengths_for(band_counts(n))
        return n - sum(j - i for i, j in collapsed_runs(bar_lengths))

    def auto_bands(max_auto=50, fallback=21):
        """Largest band count where above/below hold no more samples than the
        top/bottom real bands (beyond that, the tails look fatter than the
        distribution's own edges)."""
        best = None
        for n in range(2, max_auto + 1):
            counts = band_counts(n)
            if counts[0] < count_below or counts[-1] < count_above:
                break
            best = n
        return best if best is not None else fallback

    # Auto mode picks the band count directly; -g then just collapses its gaps
    auto = n_bands is None
    if auto:
        n_bands = auto_bands()

    # With gaps collapsed, pick the band count whose *displayed* rows come
    # closest to n_bands (approximate: one more band can shift several rows)
    if collapse_gaps and not auto:
        max_bands = 20_000
        best_n, best_diff = n_bands, abs(displayed_bands(n_bands) - n_bands)
        lo, hi = n_bands, None
        n = n_bands
        while best_diff and n < max_bands:
            shown = displayed_bands(n)
            if abs(shown - n_bands) < best_diff:
                best_n, best_diff = n, abs(shown - n_bands)
            if shown >= n_bands:
                hi = n
                break
            lo = n
            # Jump proportionally to how much of the chart is being collapsed
            n = min(max(n + 1, n * n_bands // max(shown, 1)), max_bands)

        # Narrow down between the last undershoot and the first overshoot
        if hi is not None:
            while hi - lo > 1:
                mid = (lo + hi) // 2
                shown = displayed_bands(mid)
                if abs(shown - n_bands) < best_diff or (
                        abs(shown - n_bands) == best_diff and mid < best_n):
                    best_n, best_diff = mid, abs(shown - n_bands)
                if shown >= n_bands:
                    hi = mid
                else:
                    lo = mid
        n_bands = best_n

    band_size = (upper_bound - lower_bound) / n_bands
    counts = band_counts(n_bands)
    band_labels = [lower_bound + i * band_size + band_size / 2 for i in range(n_bands)]

    # Find max count for scaling (above/below included, so a huge tail
    # visibly squashes the in-range bands rather than overflowing)
    max_count = max(max(counts), count_above, count_below)

    # Format the output (from top to bottom, like the original)
    output = "\nHistogram:\n"

    # Helper to format values (times or numbers)
    def format_value(val, seconds=False):
        if is_time and TIME_SUPPORT:
            return format_time_result(val, format_12h, seconds)
        elif abs(val) >= 1000:
            return f"{val:,.0f}"
        elif abs(val) >= 10:
            return f"{val:.1f}"
        else:
            return f"{val:.2f}"

    # Show seconds on every label if minute precision would repeat a label
    labels = [format_value(v) for v in band_labels]
    if any(a == b for a, b in zip(labels, labels[1:])):
        use_seconds = True
        labels = [format_value(v, seconds=True) for v in band_labels]
    else:
        use_seconds = False

    def format_medians(ms):
        return ", ".join(format_value(m, seconds=use_seconds) for m in ms)

    # Widen the label column if needed (e.g. "12:05:30 AM")
    width = max([10] + [len(label) for label in labels])

    def make_bar(count):
        bar_length = int((count / max_count * max_size)) if max_count > 0 else 0
        return '▒' * bar_length

    # Add "above" line
    # Median can fall outside the banded range (e.g. a spike at the 98th percentile)
    above_ms = [m for m in medians if m >= upper_bound]
    below_ms = [m for m in medians if m < lower_bound]
    above_median = f" ({format_medians(above_ms)})" if above_ms else ""
    below_median = f" ({format_medians(below_ms)})" if below_ms else ""
    output += f"{'above':>{width}s} | {make_bar(count_above)}{above_median}\n"

    # Build band rows from highest to lowest (reversed), noting which are blank
    rows = []
    for i in range(n_bands - 1, -1, -1):
        band_start = lower_bound + i * band_size
        band_end = band_start + band_size
        bar = make_bar(counts[i])

        # Check if any median falls in this band
        band_ms = [m for m in medians if band_start <= m < band_end]
        trailing = f" ({format_medians(band_ms)})" if band_ms else ""

        line = f"{labels[i]:>{width}s} | {bar}{trailing}\n"
        rows.append((line, not bar, band_start, band_end, band_ms))

    # Emit rows, collapsing runs of 2+ blank rows into a single marker line
    # (if the median falls inside a collapsed run, it's noted on the marker)
    i = 0
    while i < len(rows):
        j = i
        while collapse_gaps and j < len(rows) and rows[j][1]:
            j += 1
        if j - i >= 2:
            gap_ms = [m for row in rows[i:j] for m in row[4]]
            trailing = f" (median {format_medians(gap_ms)})" if gap_ms else ""
            output += f"{'...':>{width}s} |{trailing}\n"
            i = j
        else:
            output += rows[i][0]
            i += 1

    # Add "below" line
    output += f"{'below':>{width}s} | {make_bar(count_below)}{below_median}\n"

    return output


def interactive_mode(args):
    """Run in interactive mode."""
    print("Time Calculator - Interactive Mode")
    print("=" * 70)
    print("Operators:")
    print("  ~   : uniform distribution (e.g., 10~20 or 15m~30m)")
    print("  ~~  : normal distribution (e.g., 10~~20 or 1h~~2h)")
    print("  <~  : left-skewed (e.g., 10<~20 or 15m<~30m)")
    print("  ~>  : right-skewed (e.g., 10~>20 or 15m~>30m)")
    print("  |   : either/or, equally likely (e.g., 5~~15|30~~45)")
    print("\nExamples:")
    print("  10~20                    (numeric)")
    print("  240 - 10~20 - 5~~10      (numeric)")
    if TIME_SUPPORT:
        print("  17:30 - 15m~30m          (time)")
        print("  9:00 + 45m~~60m          (time)")
        print("  7:15~~7:45 + 5~~15|30~~45 (time, two possible paths)")
    print("\nType 'quit' or 'exit' to quit, 'help' for operators")
    print("=" * 70)

    while True:
        try:
            expr = input("\n> ").strip()

            if not expr:
                continue

            if expr.lower() in ['quit', 'exit', 'q']:
                print("Goodbye!")
                break

            if expr.lower() in ['help', 'h', '?']:
                help_text = """
Distribution Operators:
  min~max     Uniform distribution - all values equally likely
  min~~max    Normal distribution - bell curve, 95% within range
  min<~max    Left-skewed - more values near min
  min~>max    Right-skewed - more values near max
  a|b         Either/or - one branch picked per sample, equally likely

Arithmetic Operators:
  +  -  *  /  ^  ( )

Examples (Numeric):
  10~20                    Simple uniform range
  10~~20                   Normal distribution
  240 - 10~20              Event time minus travel
  240 - 10~20 - 5~~10      Multiple distributions
  (10~20 + 5) * 2          Complex expression
  5~~15|30~~45             Either 5-15 or 30-45, equally likely
"""
                if TIME_SUPPORT:
                    help_text += """
Time Support:
  Times:      17:30, 5:30pm, 9:00
  Durations:  15m, 1h, 2h30m, 90m

Examples (Time):
  17:30 - 15m~30m          When to leave for 5:30 PM event
  9:00 + 45m~~60m          Arrival time with uncertainty
  14:30 - 20m - 5m~10m     Multiple time calculations
  7:15~~7:45 + 5~~15|30~~45  Start time plus one of two duration paths
"""
                print(help_text)
                continue

            if TIME_SUPPORT:
                result = evaluate(expr, n_samples=args.samples, format_12h=args.format_12h)
            else:
                result = evaluate(expr, n_samples=args.samples)

            # Print result
            output = format_result(result, verbose=args.verbose, show_percentiles=not args.no_percentiles, path_medians=args.path_medians)
            if output.strip():  # Only print if there's content
                print(output)

            # Show histogram by default for stochastic results (unless suppressed)
            if result['type'] == 'stochastic' and not args.no_histogram:
                print(create_histogram(result, n_bands=args.buckets, collapse_gaps=args.collapse_gaps, path_medians=args.path_medians))

        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"Error: {e}")


def single_expression_mode(expr, args):
    """Evaluate a single expression."""
    try:
        if TIME_SUPPORT:
            result = evaluate(expr, n_samples=args.samples, format_12h=args.format_12h)
        else:
            result = evaluate(expr, n_samples=args.samples)

        # Print result
        output = format_result(result, verbose=args.verbose, show_percentiles=not args.no_percentiles, path_medians=args.path_medians)
        if output.strip():  # Only print if there's content
            print(output)

        # Show histogram by default for stochastic results (unless suppressed)
        if result['type'] == 'stochastic' and not args.no_histogram:
            print(create_histogram(result, n_bands=args.buckets, collapse_gaps=args.collapse_gaps, path_medians=args.path_medians))

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description='Time Calculator - Evaluate expressions with uncertainty',
        epilog="""
Examples:
  %(prog)s "10~20"
  %(prog)s "240 - 10~20 - 5~~10"
  %(prog)s --samples 500000 "100 - 15<~25"
  %(prog)s "7:15~~7:45 + 5~~15|30~~45"   # Either/or durations
  %(prog)s -g -b 40 "7:00 + 5~~10|50~~60" # Finer histogram, gaps collapsed
  %(prog)s -m "10~~20|20~~30"             # Median of each | path
  %(prog)s -i                           # Interactive mode
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        'expression',
        nargs='?',
        help='Expression to evaluate (omit for interactive mode)'
    )

    parser.add_argument(
        '-s', '--samples',
        type=int,
        default=100000,
        help='Number of Monte Carlo samples (default: 100000)'
    )

    parser.add_argument(
        '-i', '--interactive',
        action='store_true',
        help='Start in interactive mode'
    )

    parser.add_argument(
        '-v', '--verbose',
        action='store_true',
        help='Show detailed output (expression, AST, statistics, confidence intervals)'
    )

    parser.add_argument(
        '-H', '--no-histogram',
        action='store_true',
        help='Suppress histogram output'
    )

    parser.add_argument(
        '-p', '--no-percentiles',
        action='store_true',
        help='Suppress percentile output'
    )

    parser.add_argument(
        '--12h',
        action='store_true',
        dest='format_12h',
        help='Use 12-hour time format (AM/PM) for time results'
    )

    parser.add_argument(
        '-b', '--buckets',
        type=int,
        default=None,
        help='Number of histogram buckets (default: auto, plus above/below)'
    )

    parser.add_argument(
        '-g', '--collapse-gaps',
        action='store_true',
        help='Collapse runs of empty histogram buckets into a single marker line'
    )

    parser.add_argument(
        '-m', '--path-medians',
        action='store_true',
        help='Mark the median of each | path instead of the overall median'
    )

    args = parser.parse_args()

    if args.buckets is not None and args.buckets < 1:
        parser.error('--buckets must be at least 1')

    # Interactive mode if no expression provided or -i flag
    if args.interactive or not args.expression:
        interactive_mode(args)
    else:
        single_expression_mode(args.expression, args)


if __name__ == "__main__":
    main()
