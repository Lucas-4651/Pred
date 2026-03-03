// rebuild-forces.js - Version avec le bon nom de colonne
const { Client } = require('pg');

const connectionString = 'postgresql://neondb_owner:npg_un9TBcOX5yCG@ep-cold-frost-abyktlyf-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require';

async function rebuildPoissonForces() {
  const client = new Client({ connectionString });
  
  try {
    console.log('🔄 Connexion à la DB...');
    await client.connect();
    console.log('✅ Connecté à Neon\n');
    
    console.log('🔄 Reconstruction des forces Poisson...');
    
    // 1. Récupérer tous les matchs avec scores
    const matchesRes = await client.query(`
      SELECT home_team, away_team, 
             CAST(SPLIT_PART(exact_score, ':', 1) AS INTEGER) as home_goals,
             CAST(SPLIT_PART(exact_score, ':', 2) AS INTEGER) as away_goals
      FROM "Predictions"
      WHERE exact_score IS NOT NULL
    `);
    
    const matches = matchesRes.rows;
    console.log(`${matches.length} matchs trouvés avec score exact`);
    
    if (matches.length === 0) {
      console.log('❌ Aucun match avec score trouvé');
      return;
    }
    
    // 2. Initialiser les forces
    const attack = {};
    const defense = {};
    const matchCount = {};
    
    // 3. Compter les matchs par équipe
    matches.forEach(m => {
      matchCount[m.home_team] = (matchCount[m.home_team] || 0) + 1;
      matchCount[m.away_team] = (matchCount[m.away_team] || 0) + 1;
    });
    
    console.log(`Équipes trouvées: ${Object.keys(matchCount).length}`);
    
    // 4. Calculer les moyennes
    matches.forEach(m => {
      // Initialiser si nécessaire
      if (!attack[m.home_team]) attack[m.home_team] = { total: 0, count: 0 };
      if (!defense[m.home_team]) defense[m.home_team] = { total: 0, count: 0 };
      if (!attack[m.away_team]) attack[m.away_team] = { total: 0, count: 0 };
      if (!defense[m.away_team]) defense[m.away_team] = { total: 0, count: 0 };
      
      // Buts marqués
      attack[m.home_team].total += m.home_goals;
      attack[m.home_team].count++;
      attack[m.away_team].total += m.away_goals;
      attack[m.away_team].count++;
      
      // Buts encaissés (défense)
      defense[m.home_team].total += m.away_goals;
      defense[m.home_team].count++;
      defense[m.away_team].total += m.home_goals;
      defense[m.away_team].count++;
    });
    
    // 5. Normaliser (moyenne = 1.0)
    const allAttacks = Object.values(attack).map(a => a.total / a.count);
    const avgAttack = allAttacks.reduce((a, b) => a + b, 0) / allAttacks.length;
    
    const allDefenses = Object.values(defense).map(d => d.total / d.count);
    const avgDefense = allDefenses.reduce((a, b) => a + b, 0) / allDefenses.length;
    
    console.log(`Moyenne attaque: ${avgAttack.toFixed(3)}, Moyenne défense: ${avgDefense.toFixed(3)}`);
    
    const attackForces = {};
    const defenseForces = {};
    
    for (const team of Object.keys(attack)) {
      attackForces[team] = (attack[team].total / attack[team].count) / avgAttack;
      defenseForces[team] = (defense[team].total / defense[team].count) / avgDefense;
    }
    
    // 6. Sauvegarder dans le dernier LearningState
    const lastStateRes = await client.query(`
      SELECT * FROM "LearningStates" ORDER BY id DESC LIMIT 1
    `);
    
    if (lastStateRes.rows.length === 0) {
      console.log('❌ Aucun LearningState trouvé');
      return;
    }
    
    const lastState = lastStateRes.rows[0];
    console.log(`\nDernier LearningState ID: ${lastState.id}`);
    
    const extraState = lastState.extraState || {};
    extraState.poissonForces = {
      attack: attackForces,
      defense: defenseForces
    };
    
    await client.query(`
      UPDATE "LearningStates"
      SET "extraState" = $1
      WHERE id = $2
    `, [JSON.stringify(extraState), lastState.id]);
    
    console.log('✅ Forces Poisson sauvegardées dans LearningState', lastState.id);
    
    // 7. Afficher quelques exemples
    const examples = ['Liverpool', 'Manchester Blue', 'London Reds', 'N. Forest', 'Everton'];
    console.log('\n📊 Exemples de forces calculées:');
    examples.forEach(team => {
      if (attackForces[team]) {
        console.log(`  ${team}: attack=${attackForces[team].toFixed(3)}, defense=${defenseForces[team].toFixed(3)}`);
      }
    });
    
    // 8. Statistiques
    console.log('\n📈 Statistiques:');
    console.log(`  - Matchs analysés: ${matches.length}`);
    console.log(`  - Équipes: ${Object.keys(attackForces).length}`);
    console.log(`  - Attack range: ${Math.min(...Object.values(attackForces)).toFixed(3)} - ${Math.max(...Object.values(attackForces)).toFixed(3)}`);
    console.log(`  - Defense range: ${Math.min(...Object.values(defenseForces)).toFixed(3)} - ${Math.max(...Object.values(defenseForces)).toFixed(3)}`);
    
  } catch (error) {
    console.error('❌ ERREUR:', error);
  } finally {
    await client.end();
    console.log('\n🔴 Fin du script');
    process.exit(0);
  }
}

rebuildPoissonForces();