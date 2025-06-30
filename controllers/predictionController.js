const predictionService = require('../services/predictionService');
const ApiKey = require('../models/ApiKey');
const Tip = require('../models/Tip');
const logger = require('../middlewares/logger');

// controllers/predictionController.js

const sequelize = require('../config/database');


exports.predict = async (req, res) => {
  try {
    // Récupérer 4 astuces aléatoires depuis la base de données
    const tips = await Tip.findAll({
      order: sequelize.random(),
      limit: 4
    });

    res.render('index', {
      tips,
      copyright: res.locals.copyright,
      user: req.user
    });
  } catch (error) {
    logger.error('Erreur lors de la récupération des astuces: ' + error.message);
    res.render('index', {
      tips: [],
      copyright: res.locals.copyright,
      user: req.user
    });
  }
};

// ... autres fonctions du contrôleur ...

exports.predict = async (req, res) => {
  try {
    const tips = await Tip.findAll({ order: [['createdAt', 'DESC']] });
    const predictions = await predictionService.getPredictions();
    res.render('index', { 
      predictions, 
      tips,
      user: req.user // Ajouter cette ligne
    });
  } catch (error) {
    logger.error(error);
    res.status(500).render('error', { 
      message: 'Erreur de prédiction',
      user: req.user // Ajouter cette ligne
    });
  }
};

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
    await keyRecord.save();

    const predictions = await predictionService.getPredictions();
    res.json(predictions);
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};