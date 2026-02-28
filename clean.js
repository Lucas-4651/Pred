// REMPLACE tout clean.js par ceci :
require('dotenv').config();
const sequelize = require('./config/database');
const { DataTypes, Op } = require('sequelize');
const Prediction = require('./models/Prediction')(sequelize, DataTypes);
const Rating = require('./models/Rating')(sequelize, DataTypes);
const LearningState = require('./models/LearningState')(sequelize, DataTypes);

async function cleanDatabase() {
  console.log('🧹🧹🧹 NETTOYAGE COMPLET DE LA BASE DE DONNÉES 🧹🧹🧹');
  console.log('='.repeat(50));
  
  try {
    // 1. Afficher les compteurs avant nettoyage
    const beforeCounts = {
      predictions: await Prediction.count(),
      ratings: await Rating.count(),
      learningStates: await LearningState.count()
    };
    
    console.log('\n📊 ÉTAT AVANT NETTOYAGE :');
    console.log(`   - Prédictions: ${beforeCounts.predictions}`);
    console.log(`   - Ratings: ${beforeCounts.ratings}`);
    console.log(`   - États d'apprentissage: ${beforeCounts.learningStates}`);
    
    // 2. DEMANDER CONFIRMATION
    console.log('\n⚠️  ATTENTION : Cette opération va SUPPRIMER TOUTES les données !');
    console.log('Appuie sur Ctrl+C pour annuler ou attend 5 secondes pour continuer...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 3. SUPPRIMER TOUT
    console.log('\n🚀 SUPPRESSION EN COURS...');
    
    const deletedPredictions = await Prediction.destroy({
      where: {},
      truncate: true
    });
    console.log(`   ✅ ${deletedPredictions} prédictions supprimées`);
    
    const deletedRatings = await Rating.destroy({
      where: {},
      truncate: true
    });
    console.log(`   ✅ ${deletedRatings} ratings supprimés`);
    
    const deletedLearning = await LearningState.destroy({
      where: {},
      truncate: true
    });
    console.log(`   ✅ ${deletedLearning} états d'apprentissage supprimés`);
    
    // 4. Vérification
    const afterCounts = {
      predictions: await Prediction.count(),
      ratings: await Rating.count(),
      learningStates: await LearningState.count()
    };
    
    console.log('\n📊 ÉTAT APRÈS NETTOYAGE :');
    console.log(`   - Prédictions: ${afterCounts.predictions}`);
    console.log(`   - Ratings: ${afterCounts.ratings}`);
    console.log(`   - États d'apprentissage: ${afterCounts.learningStates}`);
    
    if (afterCounts.predictions === 0 && 
        afterCounts.ratings === 0 && 
        afterCounts.learningStates === 0) {
      console.log('\n🎉🎉🎉 NETTOYAGE RÉUSSI ! Base de données propre ! 🎉🎉🎉');
    }
    
  } catch (error) {
    console.error('\n❌ ERREUR PENDANT LE NETTOYAGE :', error);
  }
}

// Exécuter
cleanDatabase().then(() => {
  console.log('\n✨ Terminé');
  process.exit(0);
});