#!/usr/bin/env python3
"""
Run the original Python calculator (reference/) on fixed inputs and write
test/fixtures/reference.json, which the JS tests compare against.

    python3 -m venv .venv && .venv/bin/pip install numpy
    .venv/bin/python -I tools/make_fixtures.py

Only needs re-running if reference/ changes.
"""

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))

import numpy as np  # noqa: E402
import timecalc  # noqa: E402
from complete_calculator_time import TimeCalculatorParser, evaluate  # noqa: E402
from time_support import format_time_result  # noqa: E402

# Every example from timecalc.py's help and the demos, plus precedence and
# literal edge cases. None of these hit the three intentional differences.
PARSE = [
    "10~20", "10~~20", "10<~20", "10~>20", "240 - 10~20", "240 - 10~20 - 5~~10",
    "240 - (10~20 + 5)", "10~20 * 2", "100 - 10<~25 - 5~~10", "(10~20 + 5) * 2",
    "5~~15|30~~45", "17:30 - 15m~30m", "9:00 + 45m~~60m", "14:30 - 20m - 5m~10m",
    "5:30pm - 1h<~2h", "8:00 + 30m~>60m", "7:15~~7:45 + 5~~15|30~~45",
    "7:00 + 5~~10|50~~60", "10~~20|20~~30", "100 - 15<~25", "12:00am + 1h",
    "12:00pm - 30m", "12:30 PM + 1h", "1.5h", "2h30m + 90m", "2*3^2", "2^3^2",
    "10/4*2", "-5~5", "10 - -5", "3 * (2 + 4)", "1|2|3", "(1|2) * 10~20", "17:30",
    "1h + 30m~45m", "23:00 + 2h", "0:30 - 1h", "5.~10", "1 - 2 - 3", "8/2/2",
    "2 * -3", "+4", "0.5m * 3", "1h30m~2h", "1h 30m",
]

ERRORS = [
    "", "10~", "~10", "(1+2", "1+2)", "5:61", "13:00pm", "abc", "10~(5)",
    "1:30m", "--5", "5m~", "17:30 ~", "-5m", "1 + * 2", "()",
]

FORMAT_MINUTES = [
    0, 30, 720, 1050, 1440, 1500, -30, 59.999, 1439.99, 0.5, 754.25, 3000.75,
    61.0166, -1500.5, 719.999999, 1e-9, 2880, 4321.5, 12.5, 779.9,
]

HISTOGRAMS = [
    ("17:30 - 15m~30m - 5m~~10m", True),
    ("240 - 10~20 - 5~~10", False),
    ("7:15~~7:45 + 5~~15|30~~45", True),
    ("7:00 + 5~~10|50~~60", True),
    ("10~~20|20~~30", False),
    ("1000 * 10~20", False),
    ("0.1~0.2 * 3", False),
    ("23:30 + 10m~90m", True),
    ("12:00 + 0~1", True),
    ("1~2|100~101", False),
]
HISTOGRAM_SAMPLES = 2000
# (buckets, collapse_gaps, path_medians, format_12h): the CLI's -b, -g, -m, --12h
FLAGS = [
    (None, False, False, False), (40, False, False, False), (None, True, False, False),
    (40, True, False, False), (None, False, True, False), (None, False, False, True),
    (10, True, True, True), (5, False, False, False),
]

PERCENTILE_EXPRS = [
    "10~20", "10~~20", "10<~20", "10~>20", "5~~15|30~~45",
    "17:30 - 15m~30m - 5m~~10m", "10~20 * 1~3",
]
PERCENTILE_SAMPLES = 400_000


def f64(arr):
    return base64.b64encode(np.asarray(arr, dtype="<f8").tobytes()).decode()


def main():
    out = {"numpy": np.__version__}

    out["parse"] = []
    for expr in PARSE:
        parser = TimeCalculatorParser(expr)
        ast = parser.parse()
        case = {"expr": expr, "ast": repr(ast), "is_time": parser.has_time_literal,
                "stochastic": ast.is_stochastic()}
        if not ast.is_stochastic():
            case["value"] = ast.emit()
        out["parse"].append(case)

    out["errors"] = []
    for expr in ERRORS:
        try:
            TimeCalculatorParser(expr).parse()
        except Exception:
            out["errors"].append(expr)
        else:
            raise SystemExit(f"expected {expr!r} to fail in Python")

    out["format_time"] = [
        {"minutes": m, "h12": h12, "seconds": secs, "out": format_time_result(m, h12, secs)}
        for m in FORMAT_MINUTES for h12 in (False, True) for secs in (False, True)
    ]

    out["histograms"] = []
    for i, (expr, is_time) in enumerate(HISTOGRAMS):
        np.random.seed(1000 + i)
        result = evaluate(expr, n_samples=HISTOGRAM_SAMPLES)
        assert result["is_time"] == is_time, expr
        cases = []
        for buckets, gaps, paths, h12 in FLAGS:
            result["format_12h"] = h12
            cases.append({
                "buckets": buckets, "gaps": gaps, "paths": paths, "h12": h12,
                "report": timecalc.format_result(result, path_medians=paths),
                "histogram": timecalc.create_histogram(
                    result, n_bands=buckets, collapse_gaps=gaps, path_medians=paths),
            })
        out["histograms"].append({
            "expr": expr, "is_time": is_time, "samples": f64(result["samples"]),
            "median": float(result["median"]),
            "path_medians": result.get("path_medians"), "cases": cases,
        })

    out["percentiles"] = []
    for i, expr in enumerate(PERCENTILE_EXPRS):
        np.random.seed(i)
        result = evaluate(expr, n_samples=PERCENTILE_SAMPLES)
        out["percentiles"].append({
            "expr": expr, "n": PERCENTILE_SAMPLES,
            "percentiles": {str(p): float(v) for p, v in result["percentiles"].items()},
            "mean": float(result["mean"]), "std": float(result["std"]),
            "path_medians": result.get("path_medians"),
        })

    path = ROOT / "test" / "fixtures" / "reference.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
