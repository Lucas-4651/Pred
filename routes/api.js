// routes/api.js
const express = require('express');
const router = express.Router();
const predictionController = require('../controllers/predictionController');
const { apiKeyAuth } = require('../middlewares/auth');
const predictionService = require('../services/predictionService'); // ← NOUVEAU

// Route existante - elle continue de fonctionner !
router.get('/predict', apiKeyAuth, predictionController.apiPredict);

// NOUVELLES ROUTES pour le système auto-apprenant
router.get('/predictions', apiKeyAuth, async (req, res) => {
  try {
    const predictions = await predictionService.getPredictions();
    res.json({ 
      success: true, 
      predictions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

router.get('/predictions/stats', apiKeyAuth, async (req, res) => {
  try {
    const stats = await predictionService.getLearningStats();
    res.json({ 
      success: true, 
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Route pour les métriques (optionnel - pour monitoring)
router.get('/metrics', async (req, res) => {
  // Pas de auth nécessaire car c'est pour Prometheus/Grafana
  await predictionService.getMetrics(req, res);
});

module.exports = router;