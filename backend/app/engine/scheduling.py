"""Fixture scheduling across a limited number of pitches / TVs.

The legacy app lets several matches run at once (one per pitch) and tries to give
each player a fair rest between their own games, while spreading the load evenly
over the pitches. This module reproduces that idea:

* A ``round`` is a set of matches in which no player appears twice.
* If a round has more matches than there are pitches, it is split into
  ``slots``. Each slot can run up to ``nb_pitches`` matches at once.
* To maximise rest, a player is pushed towards the opposite half of the slot
  range from where they played in the previous round.
"""
from __future__ import annotations

import math
from collections import defaultdict


def schedule(matches: list[dict], nb_pitches: int) -> dict[int, tuple[int, int]]:
    """Assign (slot, pitch) to each match.

    ``matches`` is a list of dicts with keys ``round_number``, ``home``, ``away``.
    Returns a mapping ``index -> (slot, pitch)`` where ``pitch`` is 1-based.
    """
    nb_pitches = max(1, nb_pitches)
    by_round: dict[int, list[int]] = defaultdict(list)
    for i, m in enumerate(matches):
        by_round[m["round_number"]].append(i)

    last_slot: dict = {}
    result: dict[int, tuple[int, int]] = {}

    for rnd in sorted(by_round):
        idxs = by_round[rnd]
        m_count = len(idxs)
        n_slots = max(1, math.ceil(m_count / nb_pitches))

        def desired(i: int) -> float:
            values = []
            for side in ("home", "away"):
                pid = matches[i].get(side)
                ls = last_slot.get(pid)
                values.append(0.0 if ls is None else (ls + n_slots / 2) % n_slots)
            return sum(values) / len(values)

        ordered = sorted(idxs, key=desired, reverse=True)

        slot_teams: list[set] = [set() for _ in range(n_slots)]
        slot_count = [0] * n_slots

        for i in ordered:
            m = matches[i]
            home, away = m.get("home"), m.get("away")
            d = int(round(desired(i)))
            chosen = None
            for off in range(n_slots):
                for s in (d + off, d - off):
                    if (
                        0 <= s < n_slots
                        and slot_count[s] < nb_pitches
                        and home not in slot_teams[s]
                        and away not in slot_teams[s]
                    ):
                        chosen = s
                        break
                if chosen is not None:
                    break
            if chosen is None:  # fall back to any slot with capacity
                for s in range(n_slots):
                    if slot_count[s] < nb_pitches:
                        chosen = s
                        break
            slot_count[chosen] += 1
            slot_teams[chosen].update(x for x in (home, away) if x is not None)
            result[i] = (chosen, slot_count[chosen])
            for x in (home, away):
                if x is not None:
                    last_slot[x] = chosen

    return result
