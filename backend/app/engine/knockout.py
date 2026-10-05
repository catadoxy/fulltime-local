"""Knockout bracket construction.

Builds single-elimination brackets of arbitrary size (with byes to the next
power of two). Matches are linked so that the winner of one feeds the correct
slot of the next.
"""
from __future__ import annotations

STAGE_NAMES = {1: "final", 2: "sf", 4: "qf", 8: "r16", 16: "r32", 32: "r64"}


def _stage_name(matches_in_round: int) -> str:
    return STAGE_NAMES.get(matches_in_round, f"r{matches_in_round}")


def seed_order(m: int) -> list[int]:
    """Bracket slot order for m participants (a power of two).

    Returns a permutation of 1..m; position i holds the seed placed in slot i.
    The first-round pair for slot pair k is (order[2k], order[2k+1]).
    """
    order = [1]
    while len(order) < m:
        order = [x for o in order for x in (o, len(order) * 2 + 1 - o)]
    return order


def bracket_size(n: int) -> int:
    size = 1
    while size < n:
        size *= 2
    return size


def build_bracket(seeded_ids: list, third_place: bool = False) -> list[dict]:
    """Return a flat list of match dicts with temporary string ids.

    Each dict: {tmp_id, stage, round_number, match_number, home, away,
                next_tmp, next_slot}
    ``home``/``away`` are player ids or None (TBD / empty slot).
    """
    n = len(seeded_ids)
    if n < 2:
        raise ValueError("A knockout needs at least 2 participants")

    size = bracket_size(n)
    slots = seed_order(size)
    seed_to_player = {i + 1: pid for i, pid in enumerate(seeded_ids)}

    matches: list[dict] = []
    prev_ids: list[str] = []
    match_count = size // 2
    round_index = 0

    while match_count >= 1:
        stage = _stage_name(match_count)
        current_ids: list[str] = []
        for idx in range(match_count):
            tmp = f"r{round_index}m{idx}"
            if round_index == 0:
                s1, s2 = slots[2 * idx], slots[2 * idx + 1]
                home = seed_to_player.get(s1)
                away = seed_to_player.get(s2)
            else:
                home = away = None
            matches.append(
                {
                    "tmp_id": tmp,
                    "stage": stage,
                    "round_number": round_index,
                    "match_number": idx,
                    "home": home,
                    "away": away,
                    "next_tmp": None,
                    "next_slot": None,
                }
            )
            current_ids.append(tmp)

        if round_index > 0:
            for i, prev_tmp in enumerate(prev_ids):
                target = current_ids[i // 2]
                slot = "home" if i % 2 == 0 else "away"
                for m in matches:
                    if m["tmp_id"] == prev_tmp:
                        m["next_tmp"] = target
                        m["next_slot"] = slot
                        break

        prev_ids = current_ids
        match_count //= 2
        round_index += 1

    if third_place:
        matches.append(
            {
                "tmp_id": "third",
                "stage": "third",
                "round_number": round_index - 1,
                "match_number": 0,
                "home": None,
                "away": None,
                "next_tmp": None,
                "next_slot": None,
                "third_place": True,
            }
        )

    return matches
