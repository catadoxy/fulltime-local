"""Estimated real-world length of a tournament.

Matches are scheduled into slots: within a round, one slot can run up to
``nb_pitches`` matches at once. A slot costs ``match_minutes`` plus a
``changeover_minutes`` turnaround, so:

    total = sum(ceil(matches_in_round / pitches) for each round) x slot_minutes

Rounds run sequentially. Swiss rounds that have not been generated yet are
projected from the rounds already played.
"""
from __future__ import annotations

import math
from typing import Any

from ..models import Match, Tournament

DEFAULT_MATCH_MINUTES = 10
DEFAULT_CHANGEOVER_MINUTES = 5

# Display order for the breakdown; totals don't depend on it.
STAGE_ORDER = {
    "league": 0,
    "league_phase": 1,
    "group": 2,
    "swiss": 3,
    "r64": 4,
    "r32": 5,
    "r16": 6,
    "qf": 7,
    "sf": 8,
    "third": 9,
    "final": 10,
}


def coerce_minutes(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(low, min(high, number))


def match_minutes(settings: dict | None) -> int:
    return coerce_minutes(
        (settings or {}).get("match_minutes"), DEFAULT_MATCH_MINUTES, 1, 600
    )


def changeover_minutes(settings: dict | None) -> int:
    return coerce_minutes(
        (settings or {}).get("changeover_minutes"), DEFAULT_CHANGEOVER_MINUTES, 0, 120
    )


def _is_bye(m: Match) -> bool:
    return bool(m.played and "(bye)" in (m.note or ""))


def _round_key(item: tuple[str, int]) -> tuple[int, int]:
    stage, rnd = item
    return (STAGE_ORDER.get(stage, 99), rnd)


def estimate_tournament(t: Tournament) -> dict:
    """Return a breakdown of rounds, slots and total minutes for ``t``."""
    settings = t.settings or {}
    per_match = match_minutes(settings)
    changeover = changeover_minutes(settings)
    pitches = max(1, int(t.nb_pitches or 1))

    grouped: dict[tuple[str, int], list[Match | None]] = {}
    for m in t.matches:
        if _is_bye(m):
            continue
        grouped.setdefault((m.stage, m.round_number), []).append(m)

    # Swiss creates rounds on demand — project the remaining ones.
    if t.format == "swiss":
        total_rounds = coerce_minutes(settings.get("rounds"), 1, 1, 50)
        current = max((rnd for (stage, rnd) in grouped if stage == "swiss"), default=0)
        per_round = max(
            (len(ms) for (stage, _rnd), ms in grouped.items() if stage == "swiss"),
            default=0,
        )
        for rnd in range(current + 1, total_rounds + 1):
            grouped[("swiss", rnd)] = [None] * per_round

    rounds: list[dict] = []
    slots = 0
    for key in sorted(grouped, key=_round_key):
        stage, rnd = key
        count = len(grouped[key])
        round_slots = math.ceil(count / pitches) if count else 0
        slots += round_slots
        rounds.append({"stage": stage, "round": rnd, "matches": count, "slots": round_slots})

    slot_length = per_match + changeover
    return {
        "match_minutes": per_match,
        "changeover_minutes": changeover,
        "slot_minutes": slot_length,
        "matches": sum(r["matches"] for r in rounds),
        "slots": slots,
        "minutes": slots * slot_length,
        "rounds": rounds,
    }
