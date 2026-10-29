// The page: expression entry, keypad, live evaluation in a worker, and the
// results (summary, percentiles, histogram), plus history, share links and
// settings.

import { LAYOUT, GLYPHS, applyKey } from './keypad.js';
import { buildHistogram, histogramRows } from './engine/histogram.js';
import { formatterFor } from './engine/format.js';
import { searchLeft, PERCENTILES } from './engine/stats.js';
import { cliText } from './engine/report.js';

const $ = (id) => document.getElementById(id);
const input = $('expr');
const keypad = $('keypad');
const rowDetail = $('row-detail');

const EVAL_DELAY_MS = 120;
const LONG_PRESS_MS = 450;
const HISTORY_MAX = 50;

// ── storage: per-device conveniences, so every access tolerates failure ──────

const store = {
    get(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? fallback : JSON.parse(v);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // private mode, quota, blocked storage: the page works without it
        }
    },
};

function localPrefers12h() {
    try {
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
    } catch {
        return false;
    }
}

const settings = {
    h12: localPrefers12h(),
    samples: 100_000,
    buckets: null,
    collapseGaps: false,
    perPath: true,
    ...store.get('unsure.settings', {}),
};
let historyItems = store.get('unsure.history', []);

// ── evaluation ──────────────────────────────────────────────────────────────

let worker = null;
let job = { id: 0, expr: '' };
let inFlight = false;
let timer = 0;
let pendingShow = null; // { expr, save }: expand (and maybe save) when this result lands
let shown = null; // the result on screen: { expr, result }

function startWorker() {
    try {
        worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => receive(data);
        // No module workers (or the worker failed to load): evaluate here instead.
        worker.onerror = (e) => {
            e.preventDefault();
            worker = null;
            if (job.expr) run(job.expr);
        };
    } catch {
        worker = null;
    }
}

async function run(expr) {
    clearTimeout(timer);
    timer = 0;
    inFlight = true;
    job = { id: job.id + 1, expr };
    const { id } = job;
    if (worker) {
        worker.postMessage({ id, expr, samples: settings.samples });
        return;
    }
    const { evaluate } = await import('./engine/evaluate.js');
    try {
        receive({ id, result: evaluate(expr, { samples: settings.samples }) });
    } catch (e) {
        receive({ id, error: { message: e.message, pos: e.pos ?? null, end: e.end ?? null } });
    }
}

function schedule() {
    clearTimeout(timer);
    timer = 0;
    if (!input.value.trim()) {
        job = { id: job.id + 1, expr: '' };
        inFlight = false;
        pendingShow = null;
        shown = null;
        setStatus('');
        renderEmpty();
        return;
    }
    timer = setTimeout(() => run(input.value), EVAL_DELAY_MS);
}

function receive({ id, result, error }) {
    if (id !== job.id) return; // superseded while it was running
    inFlight = false;
    const { expr } = job;
    const show = pendingShow && pendingShow.expr === expr ? pendingShow : null;
    pendingShow = null;

    if (error) {
        $('output').classList.add('stale');
        // An error at the very end is usually just unfinished typing: say
        // nothing until "=" asks for the answer.
        const atEnd = error.pos !== null && error.pos >= expr.trimEnd().length;
        if (show) {
            setStatus(error.message, true);
            if (error.pos !== null) {
                input.focus();
                input.setSelectionRange(error.pos, Math.max(error.end ?? error.pos, error.pos));
            }
        } else {
            setStatus(atEnd ? '' : error.message);
        }
        return;
    }

    shown = { expr, result };
    setStatus('');
    render();
    if (show) {
        if (show.save) addHistory(expr, result);
        try {
            history.replaceState(null, '', `#e=${encodeURIComponent(expr)}`);
        } catch {
            // sandboxed frames may refuse; the link button still works
        }
        expand(true);
    }
}

// "=": evaluate now (or reuse what's on screen) and give the result the screen.
function commit({ save = true } = {}) {
    const expr = input.value;
    if (!expr.trim()) return;
    pendingShow = { expr, save };
    const current = !timer && job.expr === expr;
    if (current && inFlight) return; // its result is on the way
    if (current && shown?.expr === expr) receive({ id: job.id, result: shown.result });
    else run(expr);
}

function setStatus(text, loud = false) {
    const el = $('status');
    el.textContent = text;
    el.classList.toggle('error', loud);
}

function expand(on) {
    document.body.classList.toggle('expanded', on);
    if (on) $('results').scrollTop = 0;
}

// ── rendering ───────────────────────────────────────────────────────────────

const WORDS = {
    time: ['earlier', 'later'],
    duration: ['shorter', 'longer'],
    number: ['lower', 'higher'],
};

function pct(x) {
    if (x > 0 && x < 0.001) return '<0.1%';
    if (x < 0.1) return `${(x * 100).toFixed(1)}%`;
    return `${Math.round(x * 100)}%`;
}

function niceNumber(v) {
    return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
}

function svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

function renderEmpty() {
    $('intro').hidden = false;
    $('output').hidden = true;
    expand(false);
}

let histState = null; // what row taps need: rows, the histogram, formatting

function render() {
    const { result } = shown;
    const fmt = formatterFor(result.kind, { h12: settings.h12 });
    $('intro').hidden = true;
    $('output').hidden = false;
    $('output').classList.remove('stale');

    if (result.constant) {
        $('headline').textContent = result.kind === 'number' ? niceNumber(result.value) : fmt(result.value);
        $('headline-label').textContent = '';
        $('spark').hidden = true;
        $('ranges').replaceChildren();
        $('details').hidden = true;
        histState = null;
        return;
    }

    $('details').hidden = false;
    $('spark').hidden = false;
    $('headline').textContent = fmt(result.median);
    $('headline-label').textContent = 'median';

    const p = result.percentiles;
    $('ranges').replaceChildren(
        el('dt', {}, '90%'),
        el('dd', {}, `${fmt(p[5])} – ${fmt(p[95])}`),
        el('dt', {}, '50%'),
        el('dd', {}, `${fmt(p[25])} – ${fmt(p[75])}`),
    );

    $('chips').replaceChildren(
        ...PERCENTILES.map((q) => el('span', {}, el('b', {}, `${q}%`), fmt(p[q]))),
    );

    const paths = result.pathMedians;
    const multi = paths && paths.length > 1;
    $('paths').hidden = !multi;
    if (multi) {
        $('paths').replaceChildren(
            `${paths.length} paths: `,
            ...paths.flatMap(([m, share], i) => [
                i ? ' · ' : '',
                el('strong', {}, `≈${fmt(m)}`),
                ` (${pct(share)})`,
            ]),
        );
    }

    const medians = settings.perPath && multi ? paths.map(([m]) => m) : [result.median];
    const h = buildHistogram(result.sorted, {
        bands: settings.buckets,
        collapseGaps: settings.collapseGaps,
        medians,
    });
    const labelFmt = formatterFor(result.kind, { h12: settings.h12, label: true });
    const { rows, useSeconds, labelWidth } = histogramRows(h, labelFmt);
    histState = { rows, h, result, fmt: (v) => labelFmt(v, useSeconds) };

    // The detail line moves under whichever bar was tapped; reset it first,
    // before the rows it may be sitting among are replaced.
    $('hist').after(rowDetail);
    rowDetail.classList.remove('open');
    rowDetail.textContent = 'Tap a bar to see its odds.';
    renderHistogram(rows, labelWidth);
    renderSpark(h);
}

function renderHistogram(rows, labelWidth) {
    const hist = $('hist');
    hist.style.setProperty('--label-width', `${labelWidth}ch`);
    const { h, fmt } = histState;
    hist.replaceChildren(
        ...rows.map((r, i) => {
            const share = h.maxCount ? r.count / h.maxCount : 0;
            const fill = el('span', { class: 'fill' });
            // Leave room for the median tag; never let a nonzero bar vanish
            // (except a collapsed gap, which has no bar, as in the CLI).
            const visible = r.count > 0 && r.kind !== 'gap';
            fill.style.width = visible ? `max(2px, calc((100% - 4.5rem) * ${share.toFixed(5)}))` : '0';
            const mark = r.medians.length
                ? el('span', { class: 'mark' }, `◂ ${r.kind === 'gap' ? 'median ' : ''}${r.medians.map(fmt).join(', ')}`)
                : '';
            const cls = ['row', r.kind === 'band' ? '' : r.kind === 'gap' ? 'gap' : 'tail'];
            if (r.medians.length) cls.push('has-median');
            const label = r.kind === 'gap' ? '⋯' : r.label;
            return el(
                'button',
                { type: 'button', class: cls.join(' ').trim(), 'data-i': i, 'aria-label': `${label}: ${pct(r.count / h.n)}` },
                el('span', { class: 'lbl' }, label),
                el('span', { class: 'track' }, fill, mark),
            );
        }),
    );
}

function renderSpark(h) {
    const svg = $('spark').querySelector('svg');
    const max = Math.max(...h.counts) || 1;
    const w = 100 / h.nBands;
    svg.replaceChildren(
        ...h.counts.map((c, i) => {
            const start = h.lower + i * h.bandSize;
            const hasMedian = h.medians.some((m) => start <= m && m < start + h.bandSize);
            const height = (c / max) * 30;
            return svgEl('rect', {
                x: i * w + w * 0.1,
                y: 32 - height,
                width: w * 0.8,
                height,
                class: hasMedian ? 'median' : '',
            });
        }),
    );
}

function describeRow(i) {
    const { rows, h, result, fmt } = histState;
    const r = rows[i];
    const [lessWord, moreWord] = WORDS[result.kind];
    const share = pct(r.count / h.n);
    const less = searchLeft(result.sorted, r.start) / h.n;
    const more = 1 - searchLeft(result.sorted, r.end) / h.n;
    if (r.kind === 'above') {
        return [el('strong', {}, share), ` of outcomes are ${fmt(h.upper)} or ${moreWord}`];
    }
    if (r.kind === 'below') {
        return [el('strong', {}, share), ` of outcomes are ${lessWord} than ${fmt(h.lower)}`];
    }
    return [
        `${fmt(r.start)} – ${fmt(r.end)}: `,
        el('strong', {}, share),
        ` of outcomes. ${pct(less)} are ${lessWord}, ${pct(more)} ${moreWord}.`,
    ];
}

$('hist').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row || !histState) return;
    for (const r of $('hist').querySelectorAll('.selected')) r.classList.remove('selected');
    row.classList.add('selected');
    row.after(rowDetail);
    rowDetail.classList.add('open');
    rowDetail.replaceChildren(...describeRow(Number(row.dataset.i)));
});

// ── keypad ──────────────────────────────────────────────────────────────────

const KEYS = new Map(LAYOUT.flat().map((k) => [k.key, k]));

function buildKeypad() {
    for (const k of LAYOUT.flat()) {
        const b = el('button', {
            type: 'button',
            class: `key ${k.cls ?? 'digit'}`,
            'data-key': k.key,
            'aria-label': k.aria ?? k.label,
        });
        b.append(el('span', {}, k.label));
        if (k.glyph) {
            const svg = svgEl('svg', { viewBox: '0 0 24 14', 'aria-hidden': 'true' });
            svg.append(svgEl('path', { d: GLYPHS[k.glyph] }));
            b.append(svg);
        }
        if (k.hint) b.append(el('span', { class: 'hint', 'aria-hidden': 'true' }, k.hint));
        keypad.append(b);
    }
}

function pressKey(key, button) {
    if (key === '=') {
        commit();
        return;
    }
    const state = {
        text: input.value,
        start: input.selectionStart ?? input.value.length,
        end: input.selectionEnd ?? input.value.length,
    };
    const next = applyKey(state, key, { h12: settings.h12, now: new Date() });
    if (!next) {
        button?.classList.remove('denied');
        void button?.offsetWidth; // restart the animation
        button?.classList.add('denied');
        return;
    }
    navigator.vibrate?.(6);
    input.value = next.text;
    input.setSelectionRange(next.start, next.end);
    // Keep the caret in view when typing at the end of a long expression.
    if (next.end === next.text.length) input.scrollLeft = input.scrollWidth;
    schedule();
}

let press = null;

keypad.addEventListener('pointerdown', (e) => {
    const button = e.target.closest('.key');
    if (!button || e.button > 0) return;
    // Keep focus, and with it the caret, in the expression.
    e.preventDefault();
    const def = KEYS.get(button.dataset.key);
    button.classList.add('pressed');
    const p = { button, def, longFired: false, timer: 0 };
    if (def.long) {
        p.timer = setTimeout(() => {
            p.longFired = true;
            button.classList.remove('pressed');
            pressKey(def.long, button);
        }, LONG_PRESS_MS);
    }
    press = p;
    button.setPointerCapture?.(e.pointerId);
});

function endPress(fire) {
    if (!press) return;
    clearTimeout(press.timer);
    press.button.classList.remove('pressed');
    if (fire && !press.longFired) pressKey(press.def.key, press.button);
    press = null;
}

// A pointer press acts on pointerup; the click that follows it is swallowed.
// Clicks with no press before them are keyboard activation (Enter/Space on a
// focused key). e.detail can't tell them apart: touch clicks report 0 too.
let swallowClickUntil = 0;
keypad.addEventListener('pointerup', () => {
    if (press) swallowClickUntil = performance.now() + 1000;
    endPress(true);
});
keypad.addEventListener('pointercancel', () => endPress(false));
keypad.addEventListener('contextmenu', (e) => e.preventDefault());
keypad.addEventListener('click', (e) => {
    const button = e.target.closest('.key');
    if (!button) return;
    if (performance.now() < swallowClickUntil) {
        swallowClickUntil = 0;
        return;
    }
    pressKey(button.dataset.key, button);
});

// ── entry ───────────────────────────────────────────────────────────────────

function setExpression(text) {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
}

input.addEventListener('input', schedule);
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        commit();
    }
});
input.addEventListener('pointerdown', () => expand(false));
input.addEventListener('focus', () => expand(false));

$('kbd').addEventListener('click', () => {
    const on = input.getAttribute('inputmode') !== 'text';
    input.setAttribute('inputmode', on ? 'text' : 'none');
    $('kbd').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('syskbd', on);
    input.blur();
    input.focus();
});

$('spark').addEventListener('click', () => commit());
$('edit').addEventListener('click', () => {
    expand(false);
    input.focus();
});

for (const box of document.querySelectorAll('[data-examples]')) {
    box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-expr]');
        if (!b) return;
        b.closest('dialog')?.close();
        setExpression(b.dataset.expr);
        commit({ save: false });
    });
}

// ── copy and share ──────────────────────────────────────────────────────────

let toastTimer = 0;
function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // No async clipboard (plain http, older browsers): the old way.
        const ta = el('textarea', { readonly: '', 'aria-hidden': 'true' });
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    }
}

$('copy').addEventListener('click', async () => {
    if (!shown) return;
    const text = cliText(shown.result, {
        h12: settings.h12,
        bands: settings.buckets,
        collapseGaps: settings.collapseGaps,
        perPath: settings.perPath,
    });
    toast((await copyText(`${shown.expr}\n\n${text}`)) ? 'Copied' : 'Could not copy');
});

$('share').addEventListener('click', async () => {
    if (!shown) return;
    const url = `${location.origin}${location.pathname}#e=${encodeURIComponent(shown.expr)}`;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'unsure', text: shown.expr, url });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    toast((await copyText(url)) ? 'Link copied' : 'Could not copy');
});

// ── history ─────────────────────────────────────────────────────────────────

function addHistory(expr, result) {
    const fmt = formatterFor(result.kind, { h12: settings.h12 });
    const summary = result.constant
        ? `= ${result.kind === 'number' ? niceNumber(result.value) : fmt(result.value)}`
        : `≈ ${fmt(result.median)}`;
    historyItems = [{ expr, summary }, ...historyItems.filter((h) => h.expr !== expr)].slice(0, HISTORY_MAX);
    store.set('unsure.history', historyItems);
}

function renderHistory() {
    $('history-empty').hidden = historyItems.length > 0;
    $('history-clear').hidden = historyItems.length === 0;
    $('history-list').replaceChildren(
        ...historyItems.map((h) =>
            el(
                'li',
                {},
                el(
                    'button',
                    { type: 'button', 'data-expr': h.expr },
                    el('span', { class: 'h-expr' }, h.expr),
                    el('span', { class: 'h-result' }, h.summary),
                ),
            ),
        ),
    );
}

$('history-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-expr]');
    if (!b) return;
    $('history').close();
    setExpression(b.dataset.expr);
    commit({ save: false });
});

$('history-clear').addEventListener('click', () => {
    historyItems = [];
    store.set('unsure.history', historyItems);
    renderHistory();
});

// ── settings ────────────────────────────────────────────────────────────────

const form = $('settings-form');

function fillSettings() {
    const f = form.elements;
    f.h12.value = String(settings.h12);
    f.samples.value = String(settings.samples);
    f.buckets.value = settings.buckets === null ? 'auto' : String(settings.buckets);
    f.collapseGaps.checked = settings.collapseGaps;
    f.perPath.checked = settings.perPath;
}

form.addEventListener('change', () => {
    const f = form.elements;
    const before = settings.samples;
    Object.assign(settings, {
        h12: f.h12.value === 'true',
        samples: Number(f.samples.value),
        buckets: f.buckets.value === 'auto' ? null : Number(f.buckets.value),
        collapseGaps: f.collapseGaps.checked,
        perPath: f.perPath.checked,
    });
    store.set('unsure.settings', settings);
    if (settings.samples !== before && input.value.trim()) run(input.value);
    else if (shown) render();
});

// ── sheets ──────────────────────────────────────────────────────────────────

for (const b of document.querySelectorAll('[data-open]')) {
    b.addEventListener('click', () => {
        const name = b.dataset.open;
        if (name === 'history') renderHistory();
        if (name === 'settings') fillSettings();
        $(name).showModal();
    });
}

for (const d of document.querySelectorAll('dialog')) {
    d.querySelector('.close').addEventListener('click', () => d.close());
    // A tap on the backdrop lands on the dialog element itself.
    d.addEventListener('click', (e) => {
        if (e.target === d) d.close();
    });
}

// ── start ───────────────────────────────────────────────────────────────────

function loadFromHash() {
    const m = /^#e=(.*)$/.exec(location.hash);
    if (!m) return false;
    let expr;
    try {
        expr = decodeURIComponent(m[1]);
    } catch {
        return false;
    }
    setExpression(expr);
    commit({ save: false });
    return true;
}

buildKeypad();
startWorker();
window.addEventListener('hashchange', loadFromHash);
if (!loadFromHash()) renderEmpty();
input.focus();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
