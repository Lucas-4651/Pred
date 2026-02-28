// debugTeams.js
const axios = require('axios');

async function debugTeamNames() {
    const url = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/results?skip=0&take=10";
    const headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10)",
        "App-Version": "27869",
        "Origin": "https://bet261.mg",
        "Referer": "https://bet261.mg/"
    };
    
    try {
        const response = await axios.get(url, { headers });
        const matches = response.data.rounds[0].matches.slice(0, 5);
        
        console.log('🔍 ÉCHANTILLON DES NOMS DANS L\'API :');
        matches.forEach(match => {
            console.log(`   ${match.homeTeam.name} vs ${match.awayTeam.name}`);
        });
        
        // Vos prédictions
        console.log('\n📝 VOS PRÉDICTIONS :');
        const predictions = require('./data/predictions_log.json').slice(0, 5);
        predictions.forEach(p => {
            console.log(`   ${p.match}`);
        });
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    }
}

debugTeamNames();