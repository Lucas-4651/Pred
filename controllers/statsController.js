// controllers/statsController.js - VERSION CORRIGÉE
const fs = require('fs');
const path = require('path');

exports.showStats = async (req, res) => {
  try {
    console.log('📊 showStats appelé');
    
    // CHEMIN DIRECT
    const dataPath = path.join(__dirname, '../data/predictions_log.json');
    console.log('📁 Chemin des données:', dataPath);
    
    let matchLog = [];
    let stats = {
      total: 0,
      correct: 0,
      accuracy: 0,
      by_prediction: {}
    };
    
    // 1. Lire DIRECTEMENT depuis le fichier
    if (fs.existsSync(dataPath)) {
      try {
        const fileContent = fs.readFileSync(dataPath, 'utf8');
        console.log('📄 Taille fichier:', fileContent.length, 'caractères');
        
        if (fileContent.trim()) {
          matchLog = JSON.parse(fileContent);
          console.log(`✅ ${matchLog.length} entrées lues depuis le fichier`);
          
          // DEBUG: Afficher les 3 premières entrées
          console.log('🔍 Échantillon données:');
          matchLog.slice(0, 3).forEach((log, i) => {
            console.log(`  ${i+1}. ${log.match} - actual_result: ${log.actual_result}, is_correct: ${log.is_correct}`);
          });
        }
      } catch (parseError) {
        console.error('❌ Erreur parsing JSON:', parseError.message);
        matchLog = [];
      }
    } else {
      console.log(`❌ Fichier non trouvé: ${dataPath}`);
    }
    
    // 2. Calculer les stats - CORRECTION ICI
    // Utiliser une condition plus permissive
    const completed = matchLog.filter(log => {
      const hasResult = log.actual_result !== null && 
                       log.actual_result !== undefined && 
                       log.actual_result !== '';
      return hasResult;
    });
    
    console.log(`📈 Matchs complétés: ${completed.length}/${matchLog.length}`);
    
    if (completed.length > 0) {
      const correct = completed.filter(log => log.is_correct === true);
      
      console.log(`✅ Prédictions correctes: ${correct.length}/${completed.length}`);
      
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
        byPrediction[pred].accuracy = (byPrediction[pred].correct / byPrediction[pred].total * 100).toFixed(1);
      });
      
      stats = {
        total: completed.length,
        correct: correct.length,
        accuracy: (correct.length / completed.length * 100).toFixed(1),
        by_prediction: byPrediction
      };
    }
    
    // 3. Récents matchs avec résultats
    const recentMatches = completed.slice(-20).reverse();
    
    // 4. Matchs SANS résultats (pour les remplir)
    const pendingMatches = matchLog
      .filter(log => {
        const noResult = log.actual_result === null || 
                        log.actual_result === undefined || 
                        log.actual_result === '';
        return noResult;
      })
      .slice(-20)
      .reverse();
    
    console.log(`⏳ Matchs en attente: ${pendingMatches.length}`);
    console.log('📊 Stats finales:', stats);
    
    res.render('stats', {
      stats,
      recentMatches,
      pendingMatches,
      user: req.user,
      copyright: res.locals.copyright,
      totalEntries: matchLog.length,
      debug: {
        filePath: dataPath,
        fileExists: fs.existsSync(dataPath),
        matchLogCount: matchLog.length,
        completedCount: completed.length
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur showStats:', error);
    console.error('Stack:', error.stack);
    res.status(500).render('error', {
      message: 'Erreur lors du chargement des statistiques',
      user: req.user,
      error: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
};

exports.updateResult = async (req, res) => {
  try {
    console.log('=== UPDATE REQUEST ===');
    console.log('Body reçu:', req.body);
    console.log('Type de body:', typeof req.body);
    
    // Si Express ne parse pas automatiquement
    let data = req.body;
    if (!data || Object.keys(data).length === 0) {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          data = JSON.parse(body);
          console.log('Body parsé manuellement:', data);
          processAndRespond(data, res);
        } catch (e) {
          console.error('Erreur parsing:', e);
          res.json({ success: false, error: 'JSON invalide', raw: body });
        }
      });
      return;
    }
    
    // Traiter normalement
    processAndRespond(data, res);
    
  } catch (error) {
    console.error('Erreur updateResult:', error);
    res.json({ success: false, error: error.message });
  }
};

async function processAndRespond(data, res) {
  const { matchId, actualResult, actualScore } = data;
  
  console.log('Données extraites:', { matchId, actualResult, actualScore });
  
  if (!matchId || !actualResult) {
    return res.json({ 
      success: false, 
      error: 'Données manquantes',
      received: data 
    });
  }
  
  const dataPath = path.join(__dirname, '../data/predictions_log.json');
  
  try {
    // Lire le fichier
    let matchLog = [];
    if (fs.existsSync(dataPath)) {
      const content = fs.readFileSync(dataPath, 'utf8');
      matchLog = JSON.parse(content);
    }
    
    // Trouver et mettre à jour
    const matchIndex = matchLog.findIndex(m => m.match_id === matchId);
    
    if (matchIndex === -1) {
      return res.json({ 
        success: false, 
        error: 'Match non trouvé',
        matchId: matchId 
      });
    }
    
    // Mettre à jour
    const isCorrect = matchLog[matchIndex].prediction === actualResult;
    matchLog[matchIndex].actual_result = actualResult;
    matchLog[matchIndex].actual_score = actualScore || null;
    matchLog[matchIndex].is_correct = isCorrect;
    matchLog[matchIndex].updated_at = new Date().toISOString();
    
    // Sauvegarder
    fs.writeFileSync(dataPath, JSON.stringify(matchLog, null, 2));
    
    console.log('✅ Match mis à jour:', matchLog[matchIndex].match);
    
    res.json({
      success: true,
      isCorrect: isCorrect,
      matchId: matchId,
      match: matchLog[matchIndex].match,
      prediction: matchLog[matchIndex].prediction,
      actualResult: actualResult,
      message: 'Mis à jour avec succès'
    });
    
  } catch (error) {
    console.error('Erreur traitement:', error);
    res.json({ 
      success: false, 
      error: 'Erreur traitement',
      details: error.message 
    });
  }
}