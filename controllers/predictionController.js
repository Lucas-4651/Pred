// controllers/predictionController.js
const predictionService = require('../services/predictionService');
const ApiKey = require('../models/ApiKey');
const Tip = require('../models/Tip');
const logger = require('../middlewares/logger');
const sequelize = require('../config/database');

// ============ ROUTES WEB (rendu de pages) ============

/**
 * Page d'accueil avec les prédictions
 */
exports.index = async (req, res) => {
  try {
    // Récupérer 4 astuces aléatoires
    const tips = await Tip.findAll({
      order: sequelize.random(),
      limit: 4
    });

    // Récupérer les prédictions
    const predictions = await predictionService.getPredictions();

    res.render('index', {
      tips,
      predictions,
      user: req.user,
      copyright: res.locals.copyright
    });
  } catch (error) {
    logger.error('Erreur page d\'accueil: ' + error.message);
    res.render('index', {
      tips: [],
      predictions: [],
      user: req.user,
      copyright: res.locals.copyright
    });
  }
};

/**
 * Page des prédictions détaillées
 */
exports.predictions = async (req, res) => {
  try {
    const predictions = await predictionService.getPredictions();
    const tips = await Tip.findAll({ order: [['createdAt', 'DESC']], limit: 10 });
    
    res.render('predictions', {
      predictions,
      tips,
      user: req.user,
      copyright: res.locals.copyright
    });
  } catch (error) {
    logger.error('Erreur page prédictions: ' + error.message);
    res.status(500).render('error', { 
      message: 'Erreur de prédiction',
      user: req.user,
      copyright: res.locals.copyright
    });
  }
};

// ============ ROUTES API (JSON) ============

/**
 * API endpoint pour les prédictions (avec clé API)
 */
exports.apiPredict = async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'Clé API manquante' });
    }

    const keyRecord = await ApiKey.findOne({ where: { key: apiKey } });
    if (!keyRecord || !keyRecord.isActive) {
      return res.status(401).json({ error: 'Clé API invalide ou désactivée' });
    }

    // Mettre à jour la date de dernière utilisation
    keyRecord.lastUsed = new Date();
    keyRecord.usageCount = (keyRecord.usageCount || 0) + 1;
    await keyRecord.save();

    const predictions = await predictionService.getPredictions();
    
    res.json({
      success: true,
      predictions,
      meta: {
        generatedAt: new Date().toISOString(),
        count: predictions.length,
        apiKey: keyRecord.owner
      }
    });
  } catch (error) {
    logger.error('Erreur API predict: ' + error.message);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur' 
    });
  }
};

/**
 * API endpoint pour les statistiques d'apprentissage
 */
exports.apiStats = async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'Clé API manquante' });
    }

    const keyRecord = await ApiKey.findOne({ where: { key: apiKey } });
    if (!keyRecord || !keyRecord.isActive) {
      return res.status(401).json({ error: 'Clé API invalide ou désactivée' });
    }

    const stats = await predictionService.getLearningStats();
    
    res.json({
      success: true,
      stats,
      meta: {
        generatedAt: new Date().toISOString(),
        apiKey: keyRecord.owner
      }
    });
  } catch (error) {
    logger.error('Erreur API stats: ' + error.message);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur' 
    });
  }
};

// ============ ROUTES DE MAINTENANCE ============

/**
 * Forcer la mise à jour de l'apprentissage (admin seulement)
 */
exports.forceLearning = async (req, res) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const stats = await predictionService.forceLearning();
    
    res.json({
      success: true,
      message: 'Apprentissage forcé effectué',
      stats
    });
  } catch (error) {
    logger.error('Erreur force learning: ' + error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};