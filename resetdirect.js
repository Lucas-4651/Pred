// reset-vfl.js - Version avec le bon nom de table
const { Client } = require('pg');

// Configuration de connexion
const connectionString = 'postgresql://neondb_owner:npg_un9TBcOX5yCG@ep-cold-frost-abyktlyf-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require';

async function resetVFLLearning() {
  const client = new Client({ connectionString });
  
  try {
    console.log('\n🔵 CONNEXION À LA DB...');
    await client.connect();
    console.log('✅ Connecté à Neon\n');

    // 1. Récupérer le dernier learning state (avec le bon nom de table)
    const lastStateRes = await client.query(
      'SELECT * FROM "LearningStates" ORDER BY id DESC LIMIT 1;'
    );
    
    if (lastStateRes.rows.length === 0) {
      console.log('❌ Aucun learning state trouvé');
      return;
    }
    
    const state = lastStateRes.rows[0];
    console.log('📊 État ACTUEL:');
    console.log(`- ID: ${state.id}`);
    console.log(`- Timestamp: ${new Date(state.timestamp).toLocaleString()}`);
    
    // Parser les JSON
    const weights = state.weights || {};
    
    console.log('\n📈 Poids actuels:');
    console.log(`Elo: ${weights.elo?.toFixed(3) || 'N/A'}`);
    console.log(`Poisson: ${weights.poisson?.toFixed(3) || 'N/A'}`);
    console.log(`Market: ${weights.market?.toFixed(3) || 'N/A'}`);
    console.log(`H2H: ${weights.h2h?.toFixed(3) || 'N/A'}`);
    
    // 2. NOUVEL ÉTAT (reset partiel)
    const newWeights = {
      elo: 0.38,
      poisson: 0.32,
      market: 0.18,
      h2h: 0.12
    };
    
    // Parse l'extraState existant pour garder teamStyles
    const extraState = state.extraState || {};
    let parsedExtra = {};
    try {
      parsedExtra = typeof extraState === 'string' ? JSON.parse(extraState) : extraState;
    } catch (e) {
      parsedExtra = {};
    }
    
    const newExtraState = {
      ...parsedExtra,
      confidenceCalibration: {
        '30': { predicted: 0, correct: 0 },
        '40': { predicted: 0, correct: 0 },
        '50': { predicted: 0, correct: 0 },
        '60': { predicted: 0, correct: 0 },
        '70': { predicted: 0, correct: 0 },
        '80': { predicted: 0, correct: 0 },
        '90': { predicted: 0, correct: 0 }
      },
      contextMultipliers: {
        bigMatch: { elo: 1.15, poisson: 0.95, market: 0.90, h2h: 1.10 },
        derby:    { elo: 0.90, poisson: 0.95, market: 1.00, h2h: 1.25 },
        revenge:  { elo: 1.10, poisson: 1.05, market: 0.95, h2h: 1.15 },
        streak:   { elo: 1.20, poisson: 0.90, market: 1.10, h2h: 0.90 },
        mismatch: { elo: 1.10, poisson: 1.15, market: 0.90, h2h: 0.85 },
        normal:   { elo: 1.00, poisson: 1.00, market: 1.00, h2h: 1.00 }
      },
      ucb: {
        elo:     { pulls: 1, rewards: 0.5 },
        poisson: { pulls: 1, rewards: 0.5 },
        market:  { pulls: 1, rewards: 0.5 },
        h2h:     { pulls: 1, rewards: 0.5 }
      },
      recentResults: [],
      teamStyles: parsedExtra.teamStyles || {} // On garde les styles d'équipe
    };
    
    // Parse metrics
    const metrics = state.metrics || {};
    let parsedMetrics = {};
    try {
      parsedMetrics = typeof metrics === 'string' ? JSON.parse(metrics) : metrics;
    } catch (e) {
      parsedMetrics = {};
    }
    
    const newMetrics = {
      ...parsedMetrics,
      totalPredictions: parsedMetrics.totalPredictions || 0,
      correctPredictions: parsedMetrics.correctPredictions || 0,
      accuracy: parsedMetrics.totalPredictions > 0 ? 
                parsedMetrics.correctPredictions / parsedMetrics.totalPredictions : 0.5,
      vflSpecific: {
        patternAccuracy: 0.5,
        biasAdjusted: 0,
        cyclesDetected: parsedMetrics.vflSpecific?.cyclesDetected || 0
      }
    };
    
    console.log('\n🔄 NOUVEAUX poids:');
    console.log(`Elo: ${newWeights.elo}`);
    console.log(`Poisson: ${newWeights.poisson}`);
    console.log(`Market: ${newWeights.market}`);
    console.log(`H2H: ${newWeights.h2h}`);
    
    // 3. CRÉER le nouvel état (avec le bon nom de table)
    const insertQuery = `
      INSERT INTO "LearningStates" 
      (weights, metrics, "homeAdvantageBase", "homeAdvantageByTeam", "learningRates", timestamp, "extraState", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id;
    `;
    
    const values = [
      JSON.stringify(newWeights),
      JSON.stringify(newMetrics),
      state.homeAdvantageBase || 0.18,
      state.homeAdvantageByTeam || '{}',
      state.learningRates || '{}',
      Date.now(),
      JSON.stringify(newExtraState)
    ];
    
    const insertRes = await client.query(insertQuery, values);
    const newId = insertRes.rows[0].id;
    
    console.log(`\n✅ Nouvel état créé avec ID: ${newId}`);
    
    // 4. Vérification
    const verifyRes = await client.query(
      'SELECT id, weights, timestamp FROM "LearningStates" ORDER BY id DESC LIMIT 1;'
    );
    
    if (verifyRes.rows.length > 0) {
      const newWeightsCheck = verifyRes.rows[0].weights;
      console.log('\n🔍 Vérification:');
      console.log(`- ID: ${verifyRes.rows[0].id}`);
      console.log(`- Elo: ${newWeightsCheck.elo?.toFixed(3)}`);
      console.log(`- Timestamp: ${new Date(verifyRes.rows[0].timestamp).toLocaleString()}`);
      
      console.log('\n✅ RESET PARTIEL TERMINÉ AVEC SUCCÈS !');
      console.log('📝 Résumé:');
      console.log('  • Poids réinitialisés aux valeurs par défaut');
      console.log('  • Calibration confiance remise à zéro');
      console.log('  • Multiplicateurs contextuels réinitialisés');
      console.log('  • Ratings Elo et forces Poisson conservés');
      console.log('  • Styles d\'équipe conservés');
    }
    
    // 5. Stats des ratings
    const ratingsRes = await client.query('SELECT COUNT(*) FROM "Ratings";');
    console.log(`\n📊 Ratings en base: ${ratingsRes.rows[0].count} équipes`);
    
    // 6. Stats des prédictions
    const predRes = await client.query('SELECT COUNT(*) FROM "Predictions";');
    console.log(`📊 Prédictions en base: ${predRes.rows[0].count}`);
    
  } catch (error) {
    console.error('\n❌ ERREUR:', error);
  } finally {
    await client.end();
    console.log('\n🔴 FIN DU SCRIPT\n');
    process.exit(0);
  }
}

// Exécution
resetVFLLearning();