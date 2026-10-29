#!/usr/bin/env python3
"""
Complete working time calculator with distribution operators.

Uses AST-based evaluation with Monte Carlo simulation, similar to the unsure calculator.
"""

import numpy as np
from dataclasses import dataclass
from typing import Union
import re


# ==============================================================================
# AST Nodes - represent parsed expressions
# ==============================================================================

class ASTNode:
    """Base class for all AST nodes."""
    def emit(self) -> float:
        """Generate one sample from this node."""
        raise NotImplementedError

    def is_stochastic(self) -> bool:
        """Returns True if this node can produce different values."""
        raise NotImplementedError


class Number(ASTNode):
    """A constant number."""
    def __init__(self, value: float):
        self.value = value

    def emit(self) -> float:
        return self.value

    def is_stochastic(self) -> bool:
        return False

    def __repr__(self):
        return f"{self.value}"


class UniformRange(ASTNode):
    """Uniform distribution: min~max"""
    def __init__(self, min_val: float, max_val: float):
        self.min = min_val
        self.max = max_val

    def emit(self) -> float:
        return np.random.uniform(self.min, self.max)

    def is_stochastic(self) -> bool:
        return True

    def __repr__(self):
        return f"{self.min}~{self.max}"


class NormalRange(ASTNode):
    """Normal distribution: min~~max (95% of values within range)"""
    def __init__(self, min_val: float, max_val: float):
        self.min = min_val
        self.max = max_val
        self.mean = (min_val + max_val) / 2
        self.std = (max_val - min_val) / 4  # ±2σ covers the range

    def emit(self) -> float:
        return np.random.normal(self.mean, self.std)

    def is_stochastic(self) -> bool:
        return True

    def __repr__(self):
        return f"{self.min}~~{self.max}"


class LeftSkewedRange(ASTNode):
    """Left-skewed distribution: min<~max"""
    def __init__(self, min_val: float, max_val: float):
        self.min = min_val
        self.max = max_val
        self.range_size = max_val - min_val

    def emit(self) -> float:
        # Beta(2, 5) gives left skew
        u = np.random.beta(2, 5)
        return self.min + u * self.range_size

    def is_stochastic(self) -> bool:
        return True

    def __repr__(self):
        return f"{self.min}<~{self.max}"


class RightSkewedRange(ASTNode):
    """Right-skewed distribution: min~>max"""
    def __init__(self, min_val: float, max_val: float):
        self.min = min_val
        self.max = max_val
        self.range_size = max_val - min_val

    def emit(self) -> float:
        # Beta(5, 2) gives right skew
        u = np.random.beta(5, 2)
        return self.min + u * self.range_size

    def is_stochastic(self) -> bool:
        return True

    def __repr__(self):
        return f"{self.min}~>{self.max}"


class Mixture(ASTNode):
    """Equal-weight mixture: a|b|c (each branch equally likely per sample)"""
    def __init__(self, branches: list):
        self.branches = branches
        self.choice = None  # Index of the branch picked by the latest emit()

    def emit(self) -> float:
        self.choice = np.random.randint(len(self.branches))
        return self.branches[self.choice].emit()

    def is_stochastic(self) -> bool:
        return True

    def __repr__(self):
        return "(" + " | ".join(repr(b) for b in self.branches) + ")"


class BinaryOp(ASTNode):
    """Binary operation (arithmetic)."""
    def __init__(self, left: ASTNode, op: str, right: ASTNode):
        self.left = left
        self.op = op
        self.right = right

    def emit(self) -> float:
        left_val = self.left.emit()
        right_val = self.right.emit()

        if self.op == '+':
            return left_val + right_val
        elif self.op == '-':
            return left_val - right_val
        elif self.op == '*':
            return left_val * right_val
        elif self.op == '/':
            return left_val / right_val
        elif self.op == '^':
            return left_val ** right_val
        else:
            raise ValueError(f"Unknown operator: {self.op}")

    def is_stochastic(self) -> bool:
        return self.left.is_stochastic() or self.right.is_stochastic()

    def __repr__(self):
        return f"({self.left} {self.op} {self.right})"


def find_mixtures(node: ASTNode) -> list:
    """Return every Mixture node in the tree."""
    if isinstance(node, Mixture):
        return [node] + [m for b in node.branches for m in find_mixtures(b)]
    if isinstance(node, BinaryOp):
        return find_mixtures(node.left) + find_mixtures(node.right)
    return []


def sample_with_paths(ast: ASTNode, n_samples: int):
    """
    Draw n_samples from the AST.

    Returns (samples, path_ids). path_ids gives, per sample, an integer id for
    the combination of branches every '|' picked (None if there are no '|').
    """
    mixtures = find_mixtures(ast)
    if not mixtures:
        return np.array([ast.emit() for _ in range(n_samples)]), None

    samples = np.empty(n_samples)
    path_ids = np.empty(n_samples, dtype=int)
    ids = {}
    for i in range(n_samples):
        # Reset so nested mixtures that weren't reached this sample read None
        for m in mixtures:
            m.choice = None
        samples[i] = ast.emit()
        key = tuple(m.choice for m in mixtures)
        path_ids[i] = ids.setdefault(key, len(ids))
    return samples, path_ids


def path_medians(samples, path_ids) -> list:
    """(median, share) for each path, sorted by median."""
    return sorted(
        (float(np.median(samples[path_ids == p])), float(np.mean(path_ids == p)))
        for p in np.unique(path_ids)
    )


# ==============================================================================
# Simple recursive descent parser
# ==============================================================================

class TimeCalculatorParser:
    """
    Recursive descent parser for time calculator expressions.

    Grammar (in order of precedence, lowest to highest):
      expr       = term (('+' | '-') term)*
      term       = factor (('*' | '/' | '^') factor)*
      factor     = atom ('|' atom)*
      atom       = number | distribution | '(' expr ')'
      distribution = number ('~~' | '<~' | '~>' | '~') number
    """

    def __init__(self, expression: str):
        self.expression = expression.replace(' ', '')  # Remove whitespace
        self.pos = 0

    def peek(self, length=1) -> str:
        """Look ahead without consuming."""
        return self.expression[self.pos:self.pos + length]

    def consume(self, length=1) -> str:
        """Consume and return characters."""
        result = self.expression[self.pos:self.pos + length]
        self.pos += length
        return result

    def parse_number(self) -> float:
        """Parse a number (int or float)."""
        match = re.match(r'[-+]?\d+\.?\d*', self.expression[self.pos:])
        if not match:
            raise ValueError(f"Expected number at position {self.pos}")

        num_str = match.group(0)
        self.pos += len(num_str)
        return float(num_str)

    def parse_factor(self) -> ASTNode:
        """Parse a factor: atom ('|' atom)*"""
        branches = [self.parse_atom()]

        while self.peek() == '|':
            self.consume(1)
            branches.append(self.parse_atom())

        return branches[0] if len(branches) == 1 else Mixture(branches)

    def parse_atom(self) -> ASTNode:
        """Parse an atom: number, distribution, or parenthesized expression."""

        # Handle parentheses
        if self.peek() == '(':
            self.consume(1)
            result = self.parse_expr()
            if self.peek() != ')':
                raise ValueError(f"Expected ')' at position {self.pos}")
            self.consume(1)
            return result

        # Parse number (could be start of distribution or standalone)
        num1 = self.parse_number()

        # Check for distribution operators (must check ~~ before ~!)
        if self.peek(2) == '~~':
            self.consume(2)
            num2 = self.parse_number()
            return NormalRange(num1, num2)

        elif self.peek(2) == '<~':
            self.consume(2)
            num2 = self.parse_number()
            return LeftSkewedRange(num1, num2)

        elif self.peek(2) == '~>':
            self.consume(2)
            num2 = self.parse_number()
            return RightSkewedRange(num1, num2)

        elif self.peek(1) == '~':
            self.consume(1)
            num2 = self.parse_number()
            return UniformRange(num1, num2)

        # Just a number
        return Number(num1)

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
# Monte Carlo evaluation
# ==============================================================================

def evaluate(expression: str, n_samples: int = 100_000) -> dict:
    """
    Evaluate an expression using Monte Carlo simulation.

    Args:
        expression: The expression to evaluate (e.g., "240 - 10~20 - 5~~10")
        n_samples: Number of Monte Carlo samples

    Returns:
        Dictionary with statistics and samples
    """
    # Parse the expression
    parser = TimeCalculatorParser(expression)
    ast = parser.parse()

    # If not stochastic, just return the value
    if not ast.is_stochastic():
        value = ast.emit()
        return {
            'type': 'constant',
            'value': value,
            'expression': expression,
            'ast': repr(ast)
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
        'samples': samples  # Include all samples for visualization
    }
    if path_ids is not None:
        result['path_medians'] = path_medians(samples, path_ids)
    return result


# ==============================================================================
# Demo
# ==============================================================================

def demo():
    """Demonstrate the complete calculator."""

    test_cases = [
        ("10~20", "Simple uniform distribution"),
        ("10~~20", "Simple normal distribution"),
        ("10<~20", "Simple left-skewed distribution"),
        ("10~>20", "Simple right-skewed distribution"),
        ("240 - 10~20", "Arithmetic with distribution"),
        ("240 - 10~20 - 5~~10", "Multiple distributions"),
        ("240 - (10~20 + 5)", "Distribution in expression"),
        ("10~20 * 2", "Multiply distribution by constant"),
        ("100 - 10<~25 - 5~~10", "Mixed distribution types"),
    ]

    print("TIME CALCULATOR - COMPLETE IMPLEMENTATION")
    print("=" * 80)

    for expr, description in test_cases:
        print(f"\n{description}")
        print(f"Expression: {expr}")
        print("-" * 80)

        try:
            result = evaluate(expr)

            if result['type'] == 'constant':
                print(f"Result: {result['value']:.2f} (constant)")
                print(f"AST: {result['ast']}")

            else:  # stochastic
                print(f"AST: {result['ast']}")
                print(f"\nStatistics ({result['n_samples']:,} samples):")
                print(f"  Mean:     {result['mean']:8.2f}")
                print(f"  Median:   {result['median']:8.2f}")
                print(f"  Std Dev:  {result['std']:8.2f}")
                print(f"\nPercentiles:")
                print(f"   5%:  {result['percentiles'][5]:8.2f}")
                print(f"  25%:  {result['percentiles'][25]:8.2f}")
                print(f"  50%:  {result['percentiles'][50]:8.2f}")
                print(f"  75%:  {result['percentiles'][75]:8.2f}")
                print(f"  95%:  {result['percentiles'][95]:8.2f}")

        except Exception as e:
            print(f"ERROR: {e}")


    # Real-world example
    print("\n" + "=" * 80)
    print("REAL-WORLD EXAMPLE: When should I start getting ready?")
    print("=" * 80)

    event_in_minutes = 240
    expr = f"{event_in_minutes} - 10~20 - 5~~10 - 15<~25"

    print(f"\nScenario:")
    print(f"  Event starts in: {event_in_minutes} minutes")
    print(f"  Travel time: 10~20 minutes (uniform - traffic varies)")
    print(f"  Parking time: 5~~10 minutes (normal - usually quick)")
    print(f"  Getting ready: 15<~25 minutes (left-skewed - usually fast)")
    print(f"\nExpression: {expr}")

    result = evaluate(expr, n_samples=500_000)

    print(f"\nWhen should you start getting ready?")
    print("-" * 80)
    print(f"To be 90% confident: Start in {result['percentiles'][10]:.1f} minutes")
    print(f"To be 75% confident: Start in {result['percentiles'][25]:.1f} minutes")
    print(f"To be 50% confident: Start in {result['percentiles'][50]:.1f} minutes")
    print(f"\n(Lower percentiles = start earlier = more buffer time)")


if __name__ == "__main__":
    demo()
