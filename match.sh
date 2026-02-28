#!/bin/bash
# Sauvegarde ce fichier comme test_api.sh et exécute: bash test_api.sh

echo "========================================"
echo "TEST API MATCHES"
echo "========================================"

API_URL="https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/matches"

# Test 1: Headers et status
echo -e "\n1. Test de connectivité..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\nTime: %{time_total}s\nSize: %{size_download} bytes\n" \
  -H "Accept: application/json, text/plain, */*" \
  -H "User-Agent: Mozilla/5.0 (Linux; Android 10)" \
  -H "App-Version: 27869" \
  -H "Origin: https://bet261.mg" \
  -H "Referer: https://bet261.mg/" \
  --compressed \
  "$API_URL"

# Test 2: Structure JSON
echo -e "\n2. Analyse de la structure..."
RESPONSE=$(curl -s \
  -H "Accept: application/json, text/plain, */*" \
  -H "User-Agent: Mozilla/5.0 (Linux; Android 10)" \
  -H "App-Version: 27869" \
  -H "Origin: https://bet261.mg" \
  -H "Referer: https://bet261.mg/" \
  --compressed \
  "$API_URL" 2>/dev/null)

# Vérifier si JSON valide
if echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
    echo "✓ JSON valide"
    
    # Analyser structure
    echo -e "\nStructure détectée:"
    echo "$RESPONSE" | jq 'keys' 2>/dev/null
    
    # Compter rounds
    ROUNDS=$(echo "$RESPONSE" | jq '.rounds | length' 2>/dev/null)
    echo "Nombre de rounds: $ROUNDS"
    
    # Si rounds existe, analyser le premier
    if [ "$ROUNDS" -gt 0 ] 2>/dev/null; then
        echo -e "\nPremier round:"
        echo "$RESPONSE" | jq '.rounds[0] | keys' 2>/dev/null
        
        MATCHES=$(echo "$RESPONSE" | jq '.rounds[0].matches | length' 2>/dev/null)
        echo "Matchs dans premier round: $MATCHES"
        
        # Afficher un exemple de match
        if [ "$MATCHES" -gt 0 ] 2>/dev/null; then
            echo -e "\nExemple de match (premier):"
            echo "$RESPONSE" | jq '.rounds[0].matches[0] | {id, homeTeam: .homeTeam.name, awayTeam: .awayTeam.name, date}' 2>/dev/null
        fi
    fi
    
    # Sauvegarder pour inspection manuelle
    echo "$RESPONSE" | jq '.' > /tmp/matches_pretty.json 2>/dev/null
    echo -e "\n✓ Réponse complète sauvegardée: /tmp/matches_pretty.json"
    
else
    echo "✗ JSON invalide ou erreur"
    echo "Réponse brute (premiers 500 caractères):"
    echo "$RESPONSE" | head -c 500
fi

echo -e "\n========================================"
echo "TEST TERMINÉ"
echo "========================================"
