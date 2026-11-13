"""Win / draw / loss estimates for unplayed matches.

The model is deliberately small and transparent:

* Elo expectation comes from the existing tournament ratings.
* A draw share is reserved, shrinking as the rating gap widens, because evenly
  matched players draw more often than mismatched ones.
* The remaining probability splits between the two players by that expectation.

Nothing is stored; estimates are recalculated from the recorded results, so they
change automatically as a tournament progresses.
"""
from __future__ import annotations

BASE_ELO = 1000.0
MAX_DRAW_SHARE = 0.24
MIN_DRAW_SHARE = 0.10


def elo_expectation(home_elo: float, away_elo: float) -> float:
    """Probability the home player is the stronger side, ignoring draws."""
    return 1.0 / (1.0 + 10.0 ** ((away_elo - home_elo) / 400.0))


def draw_share(home_elo: float, away_elo: float) -> float:
    """Draw probability: highest when the two ratings are level."""
    closeness = 1.0 - min(1.0, abs(elo_expectation(home_elo, away_elo) - 0.5) * 2.0)
    return MIN_DRAW_SHARE + (MAX_DRAW_SHARE - MIN_DRAW_SHARE) * closeness


def match_probabilities(home_elo: float, away_elo: float) -> dict[str, int]:
    """Return ``home`` / ``draw`` / ``away`` percentages summing to 100."""
    expected = elo_expectation(home_elo, away_elo)
    draw = draw_share(home_elo, away_elo)
    decisive = 1.0 - draw
    home = round(expected * decisive * 100)
    draw_pct = round(draw * 100)
    return {
        "home": home,
        "draw": draw_pct,
        "away": 100 - home - draw_pct,
    }
