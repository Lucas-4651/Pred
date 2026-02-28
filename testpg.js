// fill_test.js
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data/predictions_log.json');

if (!fs.existsSync(dataPath)) {
    console.error('❌ Fichier non trouvé:', dataPath);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
console.log(`📊 ${data.length} matchs chargés`);

// Remplir les 3 premiers matchs avec des résultats de test
const testResults = [
    { matchId: data[0].match_id, actualResult: '2', actualScore: '1-2' }, // Leeds vs Bournemouth
    { matchId: data[5].match_id, actualResult: '1', actualScore: '2-0' }, // Newcastle vs C. Palace (92%)
    { matchId: data[6].match_id, actualResult: '1', actualScore: '3-1' }, // Liverpool vs Burnley (92%)
];

testResults.forEach(test => {
    const match = data.find(m => m.match_id === test.matchId);
    if (match) {
        match.actual_result = test.actualResult;
        match.actual_score = test.actualScore;
        match.is_correct = (match.prediction === test.actualResult);
        match.updated_at = new Date().toISOString();
        
        console.log(`✅ ${match.match}: Prédit ${match.prediction}, Réel ${test.actualResult} → ${match.is_correct ? 'CORRECT ✓' : 'FAUX ✗'}`);
    }
});

// Sauvegarder
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log('💾 Fichier sauvegardé avec 3 résultats de test');

// Afficher les stats
const completed = data.filter(m => m.actual_result !== null);
const correct = completed.filter(m => m.is_correct === true);

console.log('\n📈 STATISTIQUES :');
console.log(`   Total matchs: ${data.length}`);
console.log(`   Complétés: ${completed.length}`);
console.log(`   Corrects: ${correct.length}`);
console.log(`   Précision: ${completed.length > 0 ? ((correct.length / completed.length) * 100).toFixed(1) : 0}%`);