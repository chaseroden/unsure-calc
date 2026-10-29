#!/usr/bin/env python3
"""
Time calculator with support for time literals and durations.

Extends complete_calculator.py to support expressions like:
  17:30 - 15m~30m
  9:00 + 1h~~2h
  14:30 - 20m - 5m~10m
"""

import numpy as np
import re
from complete_calculator import (
    ASTNode, Number, UniformRange, NormalRange,
    LeftSkewedRange, RightSkewedRange, Mixture, BinaryOp,
    sample_with_paths, path_medians
)
from time_support import (
    TimeValue, Duration, parse_time_or_duration,
    detect_time_expression, format_time_result
)


# ==============================================================================
# Enhanced parser with time/duration support
# ==============================================================================

class TimeCalculatorParser:
    """
    Recursive descent parser with time and duration support.

    Supports:
      - Time literals: 17:30, 5:30pm, etc.
      - Duration literals: 15m, 1h, 2h30m, etc.
      - Distribution operators on durations: 15m~30m, 1h~~2h
      - Regular numbers: 10, 20.5, etc.
    """

    def __init__(self, expression: str):
        self.original_expression = expression
        self.expression = expression.replace(' ', '')
        self.pos = 0
        self.has_time_literal = detect_time_expression(expression)

    def peek(self, length=1) -> str:
        """Look ahead without consuming."""
        return self.expression[self.pos:self.pos + length]

    def consume(self, length=1) -> str:
        """Consume and return characters."""
        result = self.expression[self.pos:self.pos + length]
        self.pos += length
        return result

    def parse_time_or_number(self) -> float:
        """
        Parse a time, duration, or number.

        Returns the value in minutes (for times/durations) or as-is (for numbers).
        """
        # Save position in case we need to backtrack
        start_pos = self.pos

        # Try to match time pattern (HH:MM with optional AM/PM)
        time_match = re.match(r'(\d{1,2}:\d{2})(?:[ap]m)?', self.expression[self.pos:], re.IGNORECASE)
        if time_match:
            time_str = time_match.group(0)
            self.pos += len(time_str)
            time_val = TimeValue.from_string(time_str)
            return float(time_val.to_minutes())

        # Try to match duration pattern (15m, 1h, 2h30m, etc.)
        # Need to be careful not to match 'm' in other contexts
        duration_match = re.match(r'(\d+(?:\.\d+)?(?:h\d*m?|m))', self.expression[self.pos:], re.IGNORECASE)
        if duration_match:
            dur_str = duration_match.group(0)
            self.pos += len(dur_str)
            dur = Duration.from_string(dur_str)
            return float(dur.minutes)

        # Try plain number
        num_match = re.match(r'[-+]?\d+\.?\d*', self.expression[self.pos:])
        if num_match:
            num_str = num_match.group(0)
            self.pos += len(num_str)
            return float(num_str)

        raise ValueError(f"Expected time, duration, or number at position {self.pos}")

    def parse_factor(self) -> ASTNode:
        """Parse a factor: atom ('|' atom)*"""
        branches = [self.parse_atom()]

        while self.peek() == '|':
            self.consume(1)
            branches.append(self.parse_atom())

        return branches[0] if len(branches) == 1 else Mixture(branches)

    def parse_atom(self) -> ASTNode:
        """Parse an atom: time/duration/number, distribution, or parenthesized expression."""

        # Handle parentheses
        if self.peek() == '(':
            self.consume(1)
            result = self.parse_expr()
            if self.peek() != ')':
                raise ValueError(f"Expected ')' at position {self.pos}")
            self.consume(1)
            return result

        # Parse time/duration/number (could be start of distribution or standalone)
        val1 = self.parse_time_or_number()

        # Check for distribution operators (must check ~~ before ~!)
        if self.peek(2) == '~~':
            self.consume(2)
            val2 = self.parse_time_or_number()
            return NormalRange(val1, val2)

        elif self.peek(2) == '<~':
            self.consume(2)
            val2 = self.parse_time_or_number()
            return LeftSkewedRange(val1, val2)

        elif self.peek(2) == '~>':
            self.consume(2)
            val2 = self.parse_time_or_number()
            return RightSkewedRange(val1, val2)

        elif self.peek(1) == '~':
            self.consume(1)
            val2 = self.parse_time_or_number()
            return UniformRange(val1, val2)

        # Just a single value
        return Number(val1)

    def parse_term(self) -> ASTNode:
        """Parse a term: factor (('*' | '/' | '^') factor)*"""
        result = self.parse_factor()

        while self.peek() in ['*', '/', '^']:
            op = self.consume(1)
            right = self.parse_factor()
            result = BinaryOp(result, op, right)

        return result

    def parse_expr(self) -> ASTNode:
        """Parse an expression: term (('+' | '-') term)*"""
        result = self.parse_term()

        while self.peek() in ['+', '-']:
            op = self.consume(1)
            right = self.parse_term()
            result = BinaryOp(result, op, right)

        return result

    def parse(self) -> ASTNode:
        """Parse the full expression."""
        result = self.parse_expr()

        if self.pos < len(self.expression):
            raise ValueError(f"Unexpected characters at position {self.pos}: {self.expression[self.pos:]}")

        return result


# ==============================================================================
# Evaluation with time formatting
# ==============================================================================

def evaluate(expression: str, n_samples: int = 100_000, format_12h: bool = False) -> dict:
    """
    Evaluate an expression using Monte Carlo simulation.

    If the expression contains time literals, results are formatted as times.

    Args:
        expression: The expression to evaluate
        n_samples: Number of Monte Carlo samples
        format_12h: Use 12-hour format for time display

    Returns:
        Dictionary with statistics and samples
    """
    # Parse the expression
    parser = TimeCalculatorParser(expression)
    ast = parser.parse()

    # Determine if we should format as times
    is_time_expr = parser.has_time_literal

    # If not stochastic, just return the value
    if not ast.is_stochastic():
        value = ast.emit()
        return {
            'type': 'constant',
            'value': value,
            'expression': expression,
            'ast': repr(ast),
            'is_time': is_time_expr,
            'format_12h': format_12h
        }

    # Run Monte Carlo simulation
    samples, path_ids = sample_with_paths(ast, n_samples)

    # Calculate statistics
    percentiles = {p: np.percentile(samples, p) for p in [5, 10, 25, 50, 75, 90, 95]}

    result = {
        'type': 'stochastic',
        'expression': expression,
        'ast': repr(ast),
        'n_samples': n_samples,
        'mean': np.mean(samples),
        'median': np.median(samples),
        'std': np.std(samples),
        'min': np.min(samples),
        'max': np.max(samples),
        'percentiles': percentiles,
        'samples': samples,
        'is_time': is_time_expr,
        'format_12h': format_12h
    }
    if path_ids is not None:
        result['path_medians'] = path_medians(samples, path_ids)
    return result


# ==============================================================================
# Demo
# ==============================================================================

def demo():
    """Demonstrate time calculator with time literals."""

    test_cases = [
        # Regular numeric expressions (backward compatible)
        ("10~20", "Simple uniform distribution (numeric)"),
        ("240 - 10~20 - 5~~10", "Multiple distributions (numeric)"),

        # Time-based expressions
        ("17:30 - 15m~30m", "When to leave for 5:30 PM event"),
        ("9:00 + 45m~~60m", "Arrival time with uncertainty"),
        ("14:30 - 20m - 5m~10m", "Multiple time subtractions"),
        ("5:30pm - 1h<~2h", "With left-skewed duration"),
        ("8:00 + 30m~>60m", "With right-skewed duration"),
    ]

    print("TIME CALCULATOR WITH TIME SUPPORT")
    print("=" * 80)

    for expr, description in test_cases:
        print(f"\n{description}")
        print(f"Expression: {expr}")
        print("-" * 80)

        try:
            result = evaluate(expr, n_samples=100_000)

            if result['type'] == 'constant':
                value_str = format_time_result(result['value'], result['format_12h']) if result['is_time'] else f"{result['value']:.2f}"
                print(f"Result: {value_str} (constant)")
                print(f"AST: {result['ast']}")

            else:  # stochastic
                print(f"AST: {result['ast']}")
                print(f"\nStatistics ({result['n_samples']:,} samples):")

                if result['is_time']:
                    # Format as times
                    print(f"  Mean:     {format_time_result(result['mean'], result['format_12h'])}")
                    print(f"  Median:   {format_time_result(result['median'], result['format_12h'])}")
                    print(f"\nPercentiles:")
                    for p in [5, 10, 25, 50, 75, 90, 95]:
                        time_str = format_time_result(result['percentiles'][p], result['format_12h'])
                        print(f"  {p:3d}%:  {time_str}")
                else:
                    # Format as numbers
                    print(f"  Mean:     {result['mean']:8.2f}")
                    print(f"  Median:   {result['median']:8.2f}")
                    print(f"  Std Dev:  {result['std']:8.2f}")
                    print(f"\nPercentiles:")
                    for p in [5, 10, 25, 50, 75, 90, 95]:
                        print(f"  {p:3d}%:  {result['percentiles'][p]:8.2f}")

        except Exception as e:
            print(f"ERROR: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    demo()
