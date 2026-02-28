// utils/dataCollector.js
const fs = require('fs');
const path = require('path');

class DataCollector {
  constructor() {
    this.matchLog = [];
    this.PREDICTION_FILE = path.join(__dirname, '../data/predictions_log.json');
    this.ensureDataDirectory();
    this.loadExistingData();
  }
  
  ensureDataDirectory() {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }
  
  loadExistingData() {
    try {
      if (fs.existsSync(this.PREDICTION_FILE)) {
        const data = fs.readFileSync(this.PREDICTION_FILE, 'utf8');
        this.matchLog = JSON.parse(data);
        console.log(`📊 Chargé ${this.matchLog.length} prédictions existantes`);
      }
    } catch (error) {
      console.log('Aucune donnée existante, démarrage frais');
    }
  }
  
  logPrediction(predictionData, actualResult = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      match_id: predictionData.match_id,
      match: predictionData.match,
      prediction: predictionData.final_result,
      confidence: predictionData.confidence,
      exact_score_pred: predictionData.exact_score,
      half_time_pred: predictionData.half_time,
      odds_1x2: predictionData.odds_1x2,
      odds_ht: predictionData.odds_ht,
      home_form: predictionData.home_form,
      away_form: predictionData.away_form,
      actual_result: actualResult,
      actual_score: null,
      is_correct: null
    };
    
    this.matchLog.push(entry);
    
    // Sauvegarder toutes les 5 entrées
    if (this.matchLog.length % 5 === 0) {
      this.saveToFile();
    }
    
    console.log(`📝 Prédiction enregistrée: ${entry.match} -> ${entry.prediction} (${entry.confidence}%)`);
    
    return entry.match_id;
  }
  
  updateResult(matchId, actualResult, actualScore = null) {
    const entry = this.matchLog.find(log => log.match_id === matchId);
    
    if (entry) {
      entry.actual_result = actualResult;
      entry.actual_score = actualScore;
      entry.is_correct = (entry.prediction === actualResult);
      entry.updated_at = new Date().toISOString();
      
      this.saveToFile();
      console.log(`✅ Résultat mis à jour: ${entry.match} -> ${actualResult} (Prédit: ${entry.prediction})`);
      
      return entry.is_correct;
    }
    
    console.warn(`⚠️ Match ID non trouvé: ${matchId}`);
    return false;
  }
  
  saveToFile() {
    try {
      fs.writeFileSync(this.PREDICTION_FILE, JSON.stringify(this.matchLog, null, 2));
      console.log(`💾 Données sauvegardées (${this.matchLog.length} entrées)`);
    } catch (error) {
      console.error('❌ Erreur sauvegarde:', error.message);
    }
  }
  
  getStats() {
    const completed = this.matchLog.filter(log => log.actual_result !== null);
    
    if (completed.length === 0) {
      return {
        total: 0,
        correct: 0,
        accuracy: 0,
        by_prediction: {}
      };
    }
    
    const correct = completed.filter(log => log.is_correct === true);
    
    // Stats par type de prédiction
    const byPrediction = {};
    completed.forEach(log => {
      const pred = log.prediction;
      byPrediction[pred] = byPrediction[pred] || { total: 0, correct: 0 };
      byPrediction[pred].total++;
      if (log.is_correct) byPrediction[pred].correct++;
    });
    
    // Calcul des pourcentages
    Object.keys(byPrediction).forEach(pred => {
      byPrediction[pred].accuracy = byPrediction[pred].correct / byPrediction[pred].total * 100;
    });
    
    return {
      total: completed.length,
      correct: correct.length,
      accuracy: (correct.length / completed.length * 100).toFixed(1),
      by_prediction: byPrediction
    };
  }
  
  getRecentMatches(limit = 20) {
    return this.matchLog
      .filter(log => log.actual_result !== null)
      .slice(-limit)
      .reverse();
  }
}

// Exporter une instance unique
module.exports = new DataCollector();