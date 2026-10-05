"""Swiss-system pairing.

Round 1 pairs by seed. Each later round pairs players with the same score,
avoiding rematches where possible. Pairing is generated on demand from the
current standings.
"""
from __future__ import annotations


def first_round(seeded_ids: list) -> list[tuple]:
    """Classic top-vs-bottom pairing for round 1."""
    n = len(seeded_ids)
    half = n // 2
    pairs = []
    for i in range(half):
        pairs.append((seeded_ids[i], seeded_ids[n - 1 - i]))
    if n % 2 == 1:
        pairs.append((seeded_ids[half], None))  # bye
    return pairs


def pair_round(standings: list[dict], played_pairs: set[frozenset]) -> list[tuple]:
    """Pair the next Swiss round.

    ``standings`` is a list of {player_id, points, ...} already sorted.
    ``played_pairs`` contains frozensets of player ids that have already met.
    """
    ordered = [row["player_id"] for row in standings]
    remaining = list(ordered)
    pairs: list[tuple] = []

    while len(remaining) >= 2:
        a = remaining.pop(0)
        opponent = None
        for cand in remaining:
            if frozenset((a, cand)) not in played_pairs:
                opponent = cand
                break
        if opponent is None:  # everyone left already played a -> allow rematch
            opponent = remaining[0]
        remaining.remove(opponent)
        pairs.append((a, opponent))

    if remaining:
        pairs.append((remaining[0], None))  # bye

    return pairs
