# unsure calc

A phone-friendly calculator for things you're not sure about, live at
**[calc.wizbiz.ooo](https://calc.wizbiz.ooo)**. Put a range wherever you'd guess a
number, and it plays the calculation out 100,000 times and shows how the answers
spread: a median, 90%/50% ranges and a histogram.

```
17:30 - 15m~30m - 5m~~10m      when do I have to leave?
7:15~~7:45 + 5~~15|30~~45      either traffic is fine, or it isn't
1h + 30m~45m + 10m~>25m        how long will this take?
```

It is a web front end for the time-aware fork of Filip Hráček's
[Unsure Calculator](https://github.com/filiph/unsure): the engine is a JS port
of the Python in `reference/`, and everything runs in the browser.

## The language

| | | |
|---|---|---|
| `10~20` | uniform | anywhere in the range, all equally likely |
| `10~~20` | normal | bell curve, 95% between the bounds |
| `10<~20` | skewed low | usually near 10 (Beta(2,5)) |
| `10~>20` | skewed high | usually near 20 (Beta(5,2)) |
| `a\|b` | either | one or the other, equally likely; binds tighter than `* / ^` |

Plus `+ - * / ^` and brackets. `* / ^` share a precedence level and associate
left, as in the Python. Times of day are `17:30`, `5:30pm` or `5pm`; durations are
`15m`, `1h`, `2h30m` or `1.5h`. Everything is minutes underneath, so a plain number
in a time calculation counts as minutes.

A time of day is a point on the clock and a duration is the distance between two
points, so they combine the way points and distances do:

- time − time is a **duration**: `10am - 9am` is `1h`
- time ± duration (or a plain number of minutes) is a **time**: `10am - 30` is `9:30 AM`
- durations add and subtract to durations, and scale by plain numbers: `1h * 3` is `3h`
- duration ÷ duration is a **plain number**: `2h / 30m` is `4`

Adding two times of day, subtracting one from a duration, or multiplying, dividing or
raising one to a power is an error, with a hint at the operator. So is mixing a time
and a duration in one range or across `|`. A midpoint is `9am + (5pm - 9am) / 2`.
Differences are signed (`9am - 10am` is `-1h`). For a span past midnight, add `24h`:
`1am + 24h - 11pm` is `2h`.

### Differences from `timecalc.py`

The engine matches the Python output character for character, including the
histogram text (that's tested). These are the deliberate differences:

- **Results are times, durations or numbers by the rules above.** The CLI prints
  any result involving a time or duration as a clock time, so `1h + 30m` is `01:30`
  and `10am - 9am` is `01:00`. It also accepts nonsense like `9am + 5pm`, which is an error here.
- **Whitespace separates tokens.** The Python deletes it first, so `5 3` means 53.
- **`2h30` means 2h30m.** The Python silently reads it as 2h.
- **Error positions point into the text as typed**, so the bad part can be selected.
- Small additions: `5pm` (no minutes), `.5`, `0m`.

## The app

- The keypad has a row of range keys showing each distribution's shape. Tapping
  one right after another swaps it, so changing shape takes one tap.
  - `am/pm` cycles the suffix on the time before the caret.
  - `now` inserts the current time.
  - Hold `×` for `^`, and hold `⌫` to clear.
- The result updates as you type. The random generator is seeded from the
  expression, so the same input always gives the same result.
- `=` gives a phone's whole screen to the result and adds the expression to the history.
- Tap a histogram bar to see its odds; tap it again to hide them.
- *Copy as text* gives the CLI's output. *Share link* gives a `#e=` URL that reproduces the result exactly.
- Settings mirror the CLI flags: `--12h`, `-s`, `-b`, `-g`, `-m`.
- It's an installable PWA and works offline.

## Layout

```
public/            the site, served as-is (no build step)
  engine/          parse, sample, stats, histogram, format, report, evaluate
  app.js           the page; keypad.js holds the keys and their editing rules
  worker.js        runs the Monte Carlo off the main thread
  sw.js            network-first service worker
reference/         the original Python, used to generate the parity fixtures
test/              node --test; fixtures/reference.json comes from the Python
tools/             make_fixtures.py, make_icons.py
```

## Development

```bash
npm test                       # node --test, no dependencies
npm run serve                  # http://localhost:8137
```

`test/fixtures/reference.json` is the original Python's output for fixed inputs
and fixed samples. It only needs regenerating if `reference/` changes:

```bash
python3 -m venv .venv && .venv/bin/pip install numpy
.venv/bin/python -I tools/make_fixtures.py
.venv/bin/python -I tools/make_icons.py      # only if the icon changes
```

When adding a file to `public/`, add it to `SHELL` in `public/sw.js` as well, or
it won't be available offline. A test checks this.

## Deploying

`public/` is a static site with no build step: serve it from any web server
over HTTPS (the service worker needs a secure origin).

## Credits

MIT licensed. The original Unsure Calculator is © 2020 Filip Hráček; the time,
duration and shaped-range extensions come from Chase Roden's fork of it.
