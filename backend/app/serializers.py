from __future__ import annotations

from .models import Match, Participant, Tournament


def match_out(m: Match) -> dict:
    return {
        "id": m.id,
        "stage": m.stage,
        "group_id": m.group_id,
        "round_number": m.round_number,
        "match_number": m.match_number,
        "slot": m.slot,
        "pitch": m.pitch,
        "home_id": m.home_id,
        "away_id": m.away_id,
        "home_name": m.home.name if m.home else None,
        "away_name": m.away.name if m.away else None,
        "home_score": m.home_score,
        "away_score": m.away_score,
        "home_pen": m.home_pen,
        "away_pen": m.away_pen,
        "played": m.played,
        "winner_id": m.winner_id,
        "leg": m.leg,
        "note": m.note,
    }


def participant_out(p: Participant) -> dict:
    return {
        "id": p.id,
        "player_id": p.player_id,
        "player": {
            "id": p.player.id,
            "name": p.player.name,
            "real_name": p.player.real_name,
            "email": p.player.email,
            "picture": p.player.picture,
            # NOTE: seed rating stored on the player row, not live Elo.
            # Live Elo is computed via services.ratings.compute_ratings().
            "rating": p.player.rating,
        },
        "seed": p.seed,
        "group_id": p.group_id,
    }


def tournament_out(t: Tournament, detail: bool = False) -> dict:
    data = {
        "id": t.id,
        "name": t.name,
        "note": t.note,
        "format": t.format,
        "players": len(t.participants),
        "status": t.status,
        "nb_pitches": t.nb_pitches,
        "settings": t.settings,
        "start_date": t.start_date,
        "end_date": t.end_date,
        "champion_id": t.champion_id,
        "created_at": t.created_at,
    }
    if detail:
        data["groups"] = [
            {"id": g.id, "name": g.name, "sort_order": g.sort_order} for g in t.groups
        ]
        data["participants"] = [participant_out(p) for p in t.participants]
    return data
