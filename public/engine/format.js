// Value formatting. formatClock ports format_time_result from
// reference/time_support.py; formatNumberLabel ports timecalc.py's histogram
// label rules. formatDuration is new: duration-only expressions display as
// "1h 37m" rather than the CLI's clock-style "01:37".

// Python's f"{x:.{digits}f}": like toFixed, but exact ties round half-to-even
// (toFixed rounds them up), and -0 keeps its sign.
export function pyFixed(x, digits, grouping = false) {
    const neg = x < 0 || Object.is(x, -0);
    const ax = Math.abs(x);
    let s = ax.toFixed(digits);
    const probe = ax.toFixed(Math.min(digits + 30, 100));
    const dot = probe.indexOf('.');
    if (/^50*$/.test(probe.slice(dot + 1 + digits))) {
        const truncated = probe.slice(0, digits ? dot + 1 + digits : dot);
        if (Number(truncated.at(-1)) % 2 === 0) s = truncated;
    }
    if (grouping) {
        const [int, frac] = s.split('.');
        s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac === undefined ? '' : '.' + frac);
    }
    return (neg ? '-' : '') + s;
}

const pad2 = (n) => String(n).padStart(2, '0');

// Python's divmod for a non-negative float: fmod, then an exact quotient.
function divmod(x, y) {
    const mod = x % y;
    return [Math.round((x - mod) / y), mod];
}

// Minutes since midnight as a clock time. Negative values print as a negative
// clock, and values past midnight get a (+Nd) suffix, as in the CLI. Minutes
// and seconds truncate, so 07:05:59 never displays as 07:06:00.
export function formatClock(minutes, { h12 = false, seconds = false } = {}) {
    if (minutes < 0) return '-' + formatClock(-minutes, { h12, seconds });
    const [days, remaining] = divmod(minutes, 24 * 60);
    const [hDiv, mMod] = divmod(remaining, 60);
    const total = (hDiv * 60 + Math.trunc(mMod)) % (24 * 60);
    const hours = Math.floor(total / 60);
    const mins = total % 60;

    let clock;
    let meridiem = '';
    if (!h12) clock = `${pad2(hours)}:${pad2(mins)}`;
    else {
        const h = hours % 12 === 0 ? 12 : hours % 12;
        clock = `${h}:${pad2(mins)}`;
        meridiem = hours < 12 ? ' AM' : ' PM';
    }
    if (seconds) clock += ':' + pad2(Math.trunc(remaining * 60) % 60);
    const out = clock + meridiem;
    return days > 0 ? `${out} (+${days}d)` : out;
}

// Minutes as a span: "37m", "2h", "1h 37m", with seconds on request.
// Truncates like formatClock.
export function formatDuration(minutes, { seconds = false } = {}) {
    const neg = minutes < 0;
    const m = Math.abs(minutes);
    const whole = Math.trunc(m);
    const hours = Math.floor(whole / 60);
    const mins = whole % 60;
    const parts = [];
    if (hours) parts.push(`${hours}h`);
    if (mins || !hours || seconds) parts.push(`${mins}m`);
    if (seconds) parts.push(`${Math.trunc(m * 60) % 60}s`);
    return (neg ? '-' : '') + parts.join(' ');
}

// Histogram band labels for plain numbers (timecalc.py's format_value).
export function formatNumberLabel(v) {
    const a = Math.abs(v);
    if (a >= 1000) return pyFixed(v, 0, true);
    if (a >= 10) return pyFixed(v, 1);
    return pyFixed(v, 2);
}

// A formatter for one result kind: fmt(value, seconds) -> string.
// `label` is the histogram-label style; otherwise numbers get two decimals.
export function formatterFor(kind, { h12 = false, label = false } = {}) {
    if (kind === 'time') return (v, seconds = false) => formatClock(v, { h12, seconds });
    if (kind === 'duration') return (v, seconds = false) => formatDuration(v, { seconds });
    return label ? (v) => formatNumberLabel(v) : (v) => pyFixed(v, 2, true);
}
