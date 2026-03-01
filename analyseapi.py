#!/usr/bin/env python3
"""
Analyse complète des APIs VFL bet261
Objectif : comprendre la structure pour prédire le round N+1
"""

import requests
import json
from datetime import datetime

HEADERS = {
    'Accept':          'application/json, text/plain, */*',
    'User-Agent':      'Mozilla/5.0 (Linux; Android 10)',
    'App-Version':     '27869',
    'Origin':          'https://bet261.mg',
    'Referer':         'https://bet261.mg/',
    'Accept-Encoding': 'gzip, deflate'
}

BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues'
CAT  = 'eventCategoryId=135402'
PID  = 'parentEventCategoryId=8035'

def get(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        return r.json()
    except Exception as e:
        return {'error': str(e)}

def sep(title):
    print(f'\n{"="*60}')
    print(f'  {title}')
    print('='*60)

# ─────────────────────────────────────────────────────────────
sep('1. /results — Historique des rounds joués')
# ─────────────────────────────────────────────────────────────
results = get(f'{BASE}/8035/results?skip=0&take=50')
rounds  = results.get('rounds', [])
print(f'Total rounds dans /results : {len(rounds)}')
if rounds:
    print(f'Round le plus récent  : {rounds[0].get("roundNumber")}')
    print(f'Round le plus ancien  : {rounds[-1].get("roundNumber")}')
    r0 = rounds[0]
    matches = r0.get('matches', [])
    print(f'Matchs dans rounds[0] : {len(matches)}')
    if matches:
        m = matches[0]
        print(f'  Exemple match       : {m.get("homeTeam",{}).get("name")} vs {m.get("awayTeam",{}).get("name")}')
        goals = m.get('goals', [])
        print(f'  Buts disponibles    : {len(goals)}')
        if goals:
            last = goals[-1]
            print(f'  Score final         : {last.get("homeScore")}:{last.get("awayScore")}')

CURRENT_ROUND = rounds[0].get('roundNumber') if rounds else None
print(f'\n>>> Round actuel identifié : {CURRENT_ROUND}')

# ─────────────────────────────────────────────────────────────
sep('2. /matches — Structure actuelle')
# ─────────────────────────────────────────────────────────────
matches_data = get(f'{BASE}/8035/matches')
m_rounds = matches_data.get('rounds', [])
print(f'Clés retournées         : {list(matches_data.keys())}')
print(f'Nombre de rounds        : {len(m_rounds)}')
for i, r in enumerate(m_rounds[:5]):
    ms = r.get('matches', [])
    print(f'  rounds[{i}] roundNumber={r.get("roundNumber")} matches={len(ms)}')
    if ms:
        print(f'    Premier: {ms[0].get("name","?")} | bettingAllowed={ms[0].get("eventBetTypes",[{}])[0].get("bettingAllowed","?")}')

# ─────────────────────────────────────────────────────────────
sep('3. /ranking — Classement')
# ─────────────────────────────────────────────────────────────
ranking = get(f'{BASE}/8035/ranking')
teams = ranking.get('teams', [])
print(f'Nombre d\'équipes        : {len(teams)}')
if teams:
    t = teams[0]
    print(f'Clés d\'une équipe       : {list(t.keys())}')
    print(f'Exemple équipe          : pos={t.get("position")} name={t.get("name")} pts={t.get("points")}')
    print(f'Historique disponible   : {t.get("history", [])}')

# ─────────────────────────────────────────────────────────────
sep(f'4. /round/N?getNext=false — Round actuel ({CURRENT_ROUND})')
# ─────────────────────────────────────────────────────────────
if CURRENT_ROUND:
    d = get(f'{BASE}/round/{CURRENT_ROUND}?{CAT}&getNext=false')
    r = d.get('round', {})
    ms = r.get('matches', [])
    print(f'roundNumber retourné    : {r.get("roundNumber")}')
    print(f'Nombre de matchs        : {len(ms)}')
    if ms:
        m = ms[0]
        ht = m.get('homeTeam', {})
        at = m.get('awayTeam', {})
        bets = m.get('eventBetTypes', [])
        print(f'Premier match           : {ht.get("name")} vs {at.get("name")}')
        print(f'Match ID                : {m.get("id")}')
        print(f'round field             : {m.get("round")}')
        print(f'Nb bet types            : {len(bets)}')
        if bets:
            b0 = bets[0]
            print(f'  BetType[0] name       : {b0.get("name")}')
            print(f'  bettingAllowed        : {b0.get("bettingAllowed")}')
            items = b0.get('eventBetTypeItems', [])
            for item in items:
                print(f'    {item.get("shortName")} cote={item.get("odds")} active={item.get("active")} bettingAllowed={item.get("bettingAllowed")}')

# ─────────────────────────────────────────────────────────────
sep(f'5. /round/N+1?getNext=false — Round suivant ({CURRENT_ROUND+1 if CURRENT_ROUND else "?"})')
# ─────────────────────────────────────────────────────────────
if CURRENT_ROUND:
    NEXT = CURRENT_ROUND + 1
    d = get(f'{BASE}/round/{NEXT}?{CAT}&getNext=false')
    r = d.get('round', {})
    ms = r.get('matches', [])
    print(f'roundNumber retourné    : {r.get("roundNumber")}')
    print(f'Nombre de matchs        : {len(ms)}')
    if ms:
        m = ms[0]
        ht = m.get('homeTeam', {})
        at = m.get('awayTeam', {})
        bets = m.get('eventBetTypes', [])
        print(f'Premier match           : {ht.get("name")} vs {at.get("name")}')
        print(f'Match ID                : {m.get("id")}')
        print(f'round field             : {m.get("round")}')
        if bets:
            b0 = bets[0]
            print(f'  BetType[0] name       : {b0.get("name")}')
            print(f'  bettingAllowed        : {b0.get("bettingAllowed")}')
            items = b0.get('eventBetTypeItems', [])
            for item in items:
                print(f'    {item.get("shortName")} cote={item.get("odds")} active={item.get("active")} bettingAllowed={item.get("bettingAllowed")}')
    else:
        print(f'Réponse brute           : {json.dumps(d)[:200]}')

# ─────────────────────────────────────────────────────────────
sep(f'6. /round/N/playout — Round actuel ({CURRENT_ROUND})')
# ─────────────────────────────────────────────────────────────
if CURRENT_ROUND:
    d = get(f'{BASE}/round/{CURRENT_ROUND}/playout?{CAT}&{PID}')
    ms = d.get('matches', [])
    print(f'Clés retournées         : {list(d.keys())}')
    print(f'Nombre de matchs        : {len(ms)}')
    if ms:
        m = ms[0]
        goals = m.get('goals', [])
        print(f'Match ID                : {m.get("id")}')
        print(f'Buts                    : {len(goals)}')
        if goals:
            last = goals[-1]
            print(f'Score final             : {last.get("homeScore")}:{last.get("awayScore")}')
            # Calculer HT
            ht_goals = [g for g in goals if g.get('minute', 90) <= 45]
            ht_last  = ht_goals[-1] if ht_goals else None
            if ht_last:
                h, a = ht_last.get('homeScore',0), ht_last.get('awayScore',0)
                ht_result = '1' if h > a else ('2' if a > h else 'X')
                print(f'Score mi-temps          : {h}:{a} ({ht_result})')
            else:
                print(f'Mi-temps                : 0:0 (X) — aucun but avant 45\'')
    else:
        print(f'Réponse brute           : {json.dumps(d)[:200]}')

# ─────────────────────────────────────────────────────────────
sep(f'7. /round/N+1/playout — Round suivant ({CURRENT_ROUND+1 if CURRENT_ROUND else "?"})')
# ─────────────────────────────────────────────────────────────
if CURRENT_ROUND:
    d = get(f'{BASE}/round/{CURRENT_ROUND+1}/playout?{CAT}&{PID}')
    ms = d.get('matches', [])
    print(f'Clés retournées         : {list(d.keys())}')
    print(f'Nombre de matchs        : {len(ms)}')
    if not ms:
        print(f'Réponse brute           : {json.dumps(d)[:200]}')

# ─────────────────────────────────────────────────────────────
sep('8. Croisement /results + /playout — Vérification IDs')
# ─────────────────────────────────────────────────────────────
if CURRENT_ROUND and rounds:
    r0 = rounds[0]
    result_ids  = {m.get('id') for m in r0.get('matches', [])}
    playout_d   = get(f'{BASE}/round/{CURRENT_ROUND}/playout?{CAT}&{PID}')
    playout_ids = {m.get('id') for m in playout_d.get('matches', [])}
    print(f'IDs dans /results round {CURRENT_ROUND}  : {sorted(result_ids)}')
    print(f'IDs dans /playout round {CURRENT_ROUND}  : {sorted(playout_ids)}')
    common = result_ids & playout_ids
    print(f'IDs en commun           : {len(common)} / {len(result_ids)}')
    print(f'Match parfait IDs       : {"✅ OUI" if common == result_ids else "❌ NON — décalage"}')

# ─────────────────────────────────────────────────────────────
sep('9. Test /round/N+1 — Vérifier noms équipes vs /matches')
# ─────────────────────────────────────────────────────────────
if CURRENT_ROUND:
    NEXT = CURRENT_ROUND + 1
    d_next  = get(f'{BASE}/round/{NEXT}?{CAT}&getNext=false')
    r_next  = d_next.get('round', {})
    ms_next = r_next.get('matches', [])
    print(f'Round {NEXT} — {len(ms_next)} matchs:')
    for m in ms_next:
        ht   = m.get('homeTeam', {}).get('name', '?')
        at   = m.get('awayTeam', {}).get('name', '?')
        mid  = m.get('id')
        name = m.get('name', '?')
        bets = m.get('eventBetTypes', [])
        b1x2 = next((b for b in bets if b.get('name') == '1X2'), None)
        cotes = ''
        if b1x2:
            items = {i.get('shortName'): i.get('odds') for i in b1x2.get('eventBetTypeItems', [])}
            cotes = f"1={items.get('1','?')} X={items.get('X','?')} 2={items.get('2','?')}"
        print(f'  [{mid}] {name} | {cotes}')

# ─────────────────────────────────────────────────────────────
sep('10. Résumé — Recommandation architecture')
# ─────────────────────────────────────────────────────────────
print('''
SOURCES DE DONNÉES :
  ✅ /results?take=50     → historique 50 rounds (apprentissage)
  ✅ /ranking             → classement + forme (history[])
  ✅ /round/{N+1}?getNext=false → matchs + cotes du round à prédire
  ✅ /round/{N}/playout   → buts exacts + minutes pour apprentissage HT

ARCHITECTURE RECOMMANDÉE :
  fetchData()
    ├── /results          → currentRound = rounds[0].roundNumber
    ├── /ranking          → classement
    └── /round/{N+1}      → matchs à prédire (équipes + cotes)

  updateModels()
    ├── /results          → qui a joué (équipes + IDs)
    └── /round/{N}/playout → buts + HT réel (croisé par match ID)
''')

print(f'Timestamp : {datetime.now().strftime("%H:%M:%S")}')
