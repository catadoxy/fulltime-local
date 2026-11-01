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

from sqlalchemy import select
from sqlalchemy.orm import Session

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
    remaining_slots = 0
    remaining_matches = 0
    played_matches = 0

    for key in sorted(grouped, key=_round_key):
        stage, rnd = key
        items = grouped[key]
        count = len(items)
        round_slots = math.ceil(count / pitches) if count else 0
        slots += round_slots

        if items and items[0] is None:
            # Projected Swiss round: nothing played yet.
            round_remaining = count
            round_remaining_slots = round_slots
        else:
            unplayed = [m for m in items if not m.played]
            round_remaining = len(unplayed)
            if round_remaining == 0:
                round_remaining_slots = 0
            elif any(m.played for m in items):
                # A round in progress: count the distinct slots still to play.
                round_remaining_slots = len({m.slot for m in unplayed})
            else:
                # Not started (or not scheduled yet): use the planned slots.
                round_remaining_slots = math.ceil(round_remaining / pitches)

        remaining_matches += round_remaining
        remaining_slots += round_remaining_slots
        played_matches += count - round_remaining
        rounds.append(
            {
                "stage": stage,
                "round": rnd,
                "matches": count,
                "slots": round_slots,
                "remaining_matches": round_remaining,
                "remaining_slots": round_remaining_slots,
            }
        )

    slot_length = per_match + changeover
    total_matches = sum(r["matches"] for r in rounds)
    return {
        "match_minutes": per_match,
        "changeover_minutes": changeover,
        "slot_minutes": slot_length,
        "matches": total_matches,
        "played_matches": played_matches,
        "remaining_matches": remaining_matches,
        "slots": slots,
        "remaining_slots": remaining_slots,
        "minutes": slots * slot_length,
        "remaining_minutes": remaining_slots * slot_length,
        "rounds": rounds,
    }


def slot_calibration(db: Session) -> dict:
    """Median real minutes per slot from fully-played, timed tournaments.

    Used to pre-fill the changeover on new tournaments so estimates get
    closer to reality once a few events have been run.
    """
    tours = (
        db.execute(
            select(Tournament).where(
                Tournament.started_at.is_not(None),
                Tournament.finished_at.is_not(None),
            )
        )
        .scalars()
        .all()
    )

    samples: list[float] = []
    for t in tours:
        if not t.started_at or not t.finished_at:
            continue
        # Ignore events closed early with unplayed fixtures.
        if any((not m.played) and not _is_bye(m) for m in t.matches):
            continue
        estimate = estimate_tournament(t)
        if estimate["slots"] <= 0:
            continue
        minutes = (t.finished_at - t.started_at).total_seconds() / 60
        if minutes <= 0:
            continue
        per_slot = minutes / estimate["slots"]
        if 0.5 <= per_slot <= 240:
            samples.append(per_slot)

    if len(samples) < 2:
        return {"samples": len(samples), "median_slot_minutes": None}

    samples.sort()
    n = len(samples)
    middle = samples[n // 2] if n % 2 else (samples[n // 2 - 1] + samples[n // 2]) / 2
    return {"samples": n, "median_slot_minutes": round(middle, 1)}

