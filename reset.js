// reset-vfl.js
const { sequelize, models } = require('./models'); // Adapte selon ta structure
const logger = console;

async function resetVFLLearning() {
  console.log('\n🔵 DÉBUT DU RESET PARTIEL VFL\n');
  
  try {
    // 1. Récupérer le dernier learning state
    const [lastState] = await sequelize.query(
      'SELECT * FROM learning_states ORDER BY id DESC LIMIT 1;'
    );
    
    if (lastState.length === 0) {
      console.log('❌ Aucun learning state trouvé');
      return;
    }
    
    const state = lastState[0];
    console.log('📊 État ACTUEL:');
    console.log(`- ID: ${state.id}`);
    console.log(`- Timestamp: ${new Date(state.timestamp).toLocaleString()}`);
    
    // 2. Parser les données JSON
    const weights = state.weights || {};
    const metrics = state.metrics || {};
    const extraState = state.extraState || {};
    
    console.log('\n📈 Poids actuels:');
    console.log(`Elo: ${weights.elo?.toFixed(3) || 'N/A'}`);
    console.log(`Poisson: ${weights.poisson?.toFixed(3) || 'N/A'}`);
    console.log(`Market: ${weights.market?.toFixed(3) || 'N/A'}`);
    console.log(`H2H: ${weights.h2h?.toFixed(3) || 'N/A'}`);
    
    // 3. NOUVEL ÉTAT (reset partiel)
    const newWeights = {
      elo: 0.38,
      poisson: 0.32,
      market: 0.18,
      h2h: 0.12
    };
    
    const newExtraState = {
      ...extraState,
      // Reset calibration confiance
      confidenceCalibration: {
        '30': { predicted: 0, correct: 0 },
        '40': { predicted: 0, correct: 0 },
        '50': { predicted: 0, correct: 0 },
        '60': { predicted: 0, correct: 0 },
        '70': { predicted: 0, correct: 0 },
        '80': { predicted: 0, correct: 0 },
        '90': { predicted: 0, correct: 0 }
      },
      // Reset multiplicateurs contextuels
      contextMultipliers: {
        bigMatch: { elo: 1.15, poisson: 0.95, market: 0.90, h2h: 1.10 },
        derby:    { elo: 0.90, poisson: 0.95, market: 1.00, h2h: 1.25 },
        revenge:  { elo: 1.10, poisson: 1.05, market: 0.95, h2h: 1.15 },
        streak:   { elo: 1.20, poisson: 0.90, market: 1.10, h2h: 0.90 },
        mismatch: { elo: 1.10, poisson: 1.15, market: 0.90, h2h: 0.85 },
        normal:   { elo: 1.00, poisson: 1.00, market: 1.00, h2h: 1.00 }
      },
      // Reset UCB
      ucb: {
        elo:     { pulls: 1, rewards: 0.5 },
        poisson: { pulls: 1, rewards: 0.5 },
        market:  { pulls: 1, rewards: 0.5 },
        h2h:     { pulls: 1, rewards: 0.5 }
      },
      // Reset récent résultats
      recentResults: [],
      // On GARDE teamStyles et autres données précieuses
      teamStyles: extraState.teamStyles || {}
    };
    
    // On GARDE certaines métriques
    const newMetrics = {
      ...metrics,
      totalPredictions: metrics.totalPredictions || 0,
      correctPredictions: metrics.correctPredictions || 0,
      accuracy: metrics.correctPredictions / metrics.totalPredictions || 0.5,
      // Reset des métriques spécifiques
      vflSpecific: {
        patternAccuracy: 0.5,
        biasAdjusted: 0,
        cyclesDetected: metrics.vflSpecific?.cyclesDetected || 0
      }
    };
    
    console.log('\n🔄 NOUVEAUX poids:');
    console.log(`Elo: ${newWeights.elo}`);
    console.log(`Poisson: ${newWeights.poisson}`);
    console.log(`Market: ${newWeights.market}`);
    console.log(`H2H: ${newWeights.h2h}`);
    
    // 4. CRÉER le nouvel état
    const insertQuery = `
      INSERT INTO learning_states 
      (weights, metrics, homeAdvantageBase, homeAdvantageByTeam, learningRates, timestamp, extraState, createdAt, updatedAt)
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
    
    const [newState] = await sequelize.query(insertQuery, { 
      bind: values,
      type: sequelize.QueryTypes.INSERT 
    });
    
    console.log(`\n✅ Nouvel état créé avec ID: ${newState[0]?.id || 'OK'}`);
    
    // 5. Vérification
    const [verifyState] = await sequelize.query(
      'SELECT * FROM learning_states ORDER BY id DESC LIMIT 1;'
    );
    
    if (verifyState.length > 0) {
      const newWeightsCheck = verifyState[0].weights;
      console.log('\n🔍 Vérification:');
      console.log(`- ID: ${verifyState[0].id}`);
      console.log(`- Elo: ${newWeightsCheck.elo?.toFixed(3)}`);
      console.log(`- Timestamp: ${new Date(verifyState[0].timestamp).toLocaleString()}`);
      
      console.log('\n✅ RESET PARTIEL TERMINÉ AVEC SUCCÈS !');
      console.log('📝 Résumé:');
      console.log('  • Poids réinitialisés aux valeurs par défaut');
      console.log('  • Calibration confiance remise à zéro');
      console.log('  • Multiplicateurs contextuels réinitialisés');
      console.log('  • Ratings Elo et forces Poisson conservés');
      console.log('  • Styles d\'équipe conservés');
    }
    
  } catch (error) {
    console.error('\n❌ ERREUR:', error);
  } finally {
    console.log('\n🔴 FIN DU SCRIPT\n');
    process.exit(0);
  }
}

// Exécution
resetVFLLearning();
