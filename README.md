# unsure calc

A phone-friendly calculator for things you're not sure about, live at
**[calc.wizbiz.ooo](https://calc.wizbiz.ooo)**. Put a range wherever you'd guess a
number, and it plays the calculation out 100,000 times and shows how the answers
spread: a median, 90%/50% ranges, percentiles and a histogram.

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

A result is a **time** if there's a time of day anywhere in the expression, a
**duration** if there are only durations (`1h 37m`), and otherwise a plain number.

### Differences from `timecalc.py`

The engine matches the Python output character for character, including the
histogram text (that's tested). These are the deliberate differences:

- **Duration-only expressions display as durations.** The CLI prints `1h + 30m`
  as the clock time `01:30`.
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
- Tap a histogram bar to see its odds.
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
deploy/            dns.sh, deploy.sh, verify.sh
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

The site lives on the multising Linode, as a second site served by the Caddy that
is already there. It costs nothing extra. Like multising, the VM pulls from
GitHub; Caddy serves `public/` straight from the VM's checkout through a
read-only bind mount, so a deploy is just a pull:

```bash
git push && deploy/deploy.sh   # pulls on the VM, then checks what Caddy serves
```

One-time setup, already done:

1. `deploy/dns.sh` creates the `calc.wizbiz.ooo` A record pointing at the
   multising VM. Re-run it after a rebuild of that VM, because multising's
   `provision.sh` only repoints `sing`.
2. On the VM, `git clone https://github.com/chaseroden/unsure-calc.git ~/unsure-calc`.
   The repo is public, so no deploy key is needed. Do the clone before the next
   step: otherwise Docker creates the bind-mount source as an empty directory
   owned by root.
3. In multising, add a `calc.wizbiz.ooo` site block to `deploy/Caddyfile` and a
   `../unsure-calc/public:/srv/calc:ro` volume to the caddy service in
   `docker-compose.vm.yml`. Its `cloud-init.yaml` also clones this repo, so a
   rebuilt VM gets it. Apply the change with
   `docker compose -f docker-compose.vm.yml up -d --force-recreate caddy`:
   the Caddyfile is a single-file bind mount, so after a `git pull` a plain
   `caddy reload` would still read the old file.

## Credits

MIT licensed. The original Unsure Calculator is © 2020 Filip Hráček; the time,
duration and shaped-range extensions come from Chase Roden's fork of it.
