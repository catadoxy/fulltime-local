"""Round-robin fixture generation (circle / Berger method).

Produces a list of rounds; each round is a list of ``(home_id, away_id)`` pairs
where every team appears exactly once. Handles an odd number of teams by adding
a bye. Home/away is alternated for fairness.
"""
from __future__ import annotations


def round_robin(team_ids: list) -> list[list[tuple]]:
    teams: list = list(team_ids)
    bye = None
    if len(teams) % 2 == 1:
        teams.append(bye)
    n = len(teams)
    if n < 2:
        return []

    rounds: list[list[tuple]] = []
    arr = teams[:]
    for r in range(n - 1):
        pairs: list[tuple] = []
        for i in range(n // 2):
            a = arr[i]
            b = arr[n - 1 - i]
            if a is bye or b is bye:
                continue
            # Alternate which side is home to balance home/away.
            if (r + i) % 2 == 0:
                pairs.append((a, b))
            else:
                pairs.append((b, a))
        rounds.append(pairs)
        # Rotate all but the first element.
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    return rounds


def round_robin_double(team_ids: list) -> list[list[tuple]]:
    """Single round-robin plus the mirrored reverse fixtures."""
    first = round_robin(team_ids)
    second = [[(away, home) for (home, away) in rnd] for rnd in first]
    return first + second
