const ApiKey = require('../models/ApiKey');

exports.ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash('error', 'Veuillez vous connecter pour accéder à cette page');
  res.redirect('/admin/login');
};

exports.apiKeyAuth = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Clé API manquante',
      solution: 'Ajoutez votre clé API dans les headers avec la clé "X-API-Key"'
    });
  }

  try {
    const keyRecord = await ApiKey.findOne({ 
      where: { 
        key: apiKey,
        isActive: true
      }
    });
    
    if (!keyRecord) {
      return res.status(401).json({ 
        error: 'Clé API invalide ou désactivée',
        hint: 'Les clés sont au format: MotChiffre (ex: SuperPrediction25)',
        solution: 'Veuillez vérifier votre clé ou contacter le support'
      });
    }

    // Vérifier si la clé est expirée
    if (keyRecord.expiresAt && new Date() > keyRecord.expiresAt) {
      await keyRecord.update({ isActive: false });
      return res.status(401).json({ 
        error: 'Clé API expirée',
        solution: 'Veuillez renouveler votre abonnement'
      });
    }

    // Mettre à jour la date de dernière utilisation et le compteur
    keyRecord.lastUsed = new Date();
    keyRecord.usageCount = (keyRecord.usageCount || 0) + 1;
    await keyRecord.save();

    next();
  } catch (error) {
    console.error('Erreur API Key Auth:', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      details: error.message
    });
  }
};