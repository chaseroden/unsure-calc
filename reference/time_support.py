#!/usr/bin/env python3
"""
Time support for the calculator.

Allows expressions like:
  17:30 - 15m~30m         "When should I leave?"
  9:00 + 45m~~60m         "When will I arrive?"
  14:30 - 20m - 5m~10m    "Accounting for multiple delays"
"""

import re
from datetime import datetime, timedelta
from typing import Union, Optional, Tuple


class TimeValue:
    """Represents a time of day (hours and minutes)."""

    def __init__(self, hours: int, minutes: int):
        # Normalize to 0-23 hours, 0-59 minutes
        total_minutes = hours * 60 + minutes
        self.total_minutes = total_minutes % (24 * 60)  # Handle day wrap
        self.hours = self.total_minutes // 60
        self.minutes = self.total_minutes % 60

    @classmethod
    def from_string(cls, s: str) -> 'TimeValue':
        """
        Parse time strings like:
          17:30, 5:30pm, 5:30 PM, 05:30
        """
        s = s.strip().lower()

        # Check for AM/PM
        is_pm = 'pm' in s
        is_am = 'am' in s
        s = s.replace('am', '').replace('pm', '').strip()

        # Parse HH:MM
        match = re.match(r'^(\d{1,2}):(\d{2})$', s)
        if not match:
            raise ValueError(f"Invalid time format: {s}")

        hours = int(match.group(1))
        minutes = int(match.group(2))

        # Handle 12-hour format
        if is_pm and hours != 12:
            hours += 12
        elif is_am and hours == 12:
            hours = 0

        if hours < 0 or hours > 23:
            raise ValueError(f"Hours must be 0-23: {hours}")
        if minutes < 0 or minutes > 59:
            raise ValueError(f"Minutes must be 0-59: {minutes}")

        return cls(hours, minutes)

    @classmethod
    def from_minutes(cls, minutes: float) -> 'TimeValue':
        """Create TimeValue from total minutes since midnight."""
        hours = int(minutes // 60)
        mins = int(minutes % 60)
        return cls(hours, mins)

    def to_minutes(self) -> int:
        """Convert to total minutes since midnight."""
        return self.total_minutes

    def __repr__(self):
        return f"TimeValue({self.hours:02d}:{self.minutes:02d})"

    def __str__(self):
        return f"{self.hours:02d}:{self.minutes:02d}"

    def to_12h(self) -> str:
        """Format as 12-hour time with AM/PM."""
        if self.hours == 0:
            return f"12:{self.minutes:02d} AM"
        elif self.hours < 12:
            return f"{self.hours}:{self.minutes:02d} AM"
        elif self.hours == 12:
            return f"12:{self.minutes:02d} PM"
        else:
            return f"{self.hours - 12}:{self.minutes:02d} PM"


class Duration:
    """Represents a duration (time span) in minutes."""

    def __init__(self, minutes: float):
        self.minutes = minutes

    @classmethod
    def from_string(cls, s: str) -> 'Duration':
        """
        Parse duration strings like:
          15m, 30m, 1h, 2h30m, 90m
        """
        s = s.strip().lower()

        total_minutes = 0

        # Parse hours (e.g., "2h" or "2h30m")
        hour_match = re.search(r'(\d+(?:\.\d+)?)h', s)
        if hour_match:
            hours = float(hour_match.group(1))
            total_minutes += hours * 60

        # Parse minutes (e.g., "30m" or "2h30m")
        min_match = re.search(r'(\d+(?:\.\d+)?)m', s)
        if min_match:
            minutes = float(min_match.group(1))
            total_minutes += minutes

        if total_minutes == 0:
            raise ValueError(f"Invalid duration format: {s}")

        return cls(total_minutes)

    def __repr__(self):
        return f"Duration({self.minutes}m)"

    def __str__(self):
        if self.minutes >= 60:
            hours = int(self.minutes // 60)
            mins = int(self.minutes % 60)
            if mins == 0:
                return f"{hours}h"
            else:
                return f"{hours}h{mins}m"
        else:
            return f"{int(self.minutes)}m"


def parse_time_or_duration(token: str) -> Union[TimeValue, Duration, float, None]:
    """
    Try to parse a token as a time, duration, or number.

    Returns:
      - TimeValue if it looks like a time (HH:MM)
      - Duration if it looks like a duration (15m, 1h, etc.)
      - float if it's a plain number
      - None if it can't be parsed
    """
    token = token.strip()

    # Try time format (HH:MM with optional AM/PM)
    if re.match(r'^\d{1,2}:\d{2}(?:\s*[ap]m)?$', token, re.IGNORECASE):
        try:
            return TimeValue.from_string(token)
        except ValueError:
            pass

    # Try duration format (15m, 1h, 2h30m, etc.)
    if re.search(r'\d+[hm]', token, re.IGNORECASE):
        try:
            return Duration.from_string(token)
        except ValueError:
            pass

    # Try plain number
    try:
        return float(token)
    except ValueError:
        pass

    return None


def detect_time_expression(expr: str) -> bool:
    """
    Detect if an expression contains time literals.

    Returns True if the expression uses time notation (HH:MM or durations with h/m).
    """
    # Look for time patterns (HH:MM)
    if re.search(r'\d{1,2}:\d{2}', expr):
        return True

    # Look for duration patterns (15m, 1h, etc.)
    if re.search(r'\d+[hm](?:[^a-z]|$)', expr, re.IGNORECASE):
        return True

    return False


def format_time_result(minutes: float, format_12h: bool = False, seconds: bool = False) -> str:
    """
    Format a result as a time.

    Args:
        minutes: Total minutes since midnight (can be negative or > 1440)
        format_12h: If True, use 12-hour format with AM/PM
        seconds: If True, include seconds (HH:MM:SS)

    Returns:
        Formatted time string
    """
    # Handle negative times (show as negative offset from midnight)
    if minutes < 0:
        return f"-{format_time_result(-minutes, format_12h, seconds)}"

    # Handle times beyond 24 hours
    days = int(minutes // (24 * 60))
    remaining_minutes = minutes % (24 * 60)

    time_val = TimeValue.from_minutes(remaining_minutes)
    time_str = time_val.to_12h() if format_12h else str(time_val)

    if seconds:
        # Truncate like the minutes do, so 07:05:59 never displays as 07:06:00
        secs = int(remaining_minutes * 60) % 60
        if format_12h:
            clock, meridiem = time_str.split(' ')
            time_str = f"{clock}:{secs:02d} {meridiem}"
        else:
            time_str = f"{time_str}:{secs:02d}"

    if days > 0:
        return f"{time_str} (+{days}d)"
    return time_str


if __name__ == "__main__":
    # Test time parsing
    print("Time Parsing Tests:")
    print("=" * 60)

    test_times = ["17:30", "5:30pm", "5:30 PM", "05:30", "12:00am", "12:00pm"]
    for t in test_times:
        tv = TimeValue.from_string(t)
        print(f"{t:15s} -> {tv} ({tv.to_12h()})")

    print("\nDuration Parsing Tests:")
    print("=" * 60)

    test_durations = ["15m", "1h", "2h30m", "90m", "0.5h"]
    for d in test_durations:
        dur = Duration.from_string(d)
        print(f"{d:15s} -> {dur} ({dur.minutes} minutes)")

    print("\nExpression Detection Tests:")
    print("=" * 60)

    test_exprs = [
        "17:30 - 15m~30m",
        "240 - 10~20",
        "9:00 + 1h~~2h",
        "100 + 50"
    ]
    for expr in test_exprs:
        is_time = detect_time_expression(expr)
        print(f"{expr:30s} -> Time expression: {is_time}")

    print("\nTime Formatting Tests:")
    print("=" * 60)

    test_minutes = [0, 30, 720, 1050, 1440, 1500, -30]
    for mins in test_minutes:
        fmt_24h = format_time_result(mins, format_12h=False)
        fmt_12h = format_time_result(mins, format_12h=True)
        print(f"{mins:6.0f} min -> {fmt_24h:20s} / {fmt_12h}")
