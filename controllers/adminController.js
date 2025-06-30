const Tip = require('../models/Tip');
const ApiKey = require('../models/ApiKey');
const User = require('../models/User');
const logger = require('../middlewares/logger');
const { generateReadableKey } = require('../utils/keyGenerator');
const { Op } = require('sequelize');
const passport = require('passport');

exports.dashboard = async (req, res) => {
  try {
    const tips = await Tip.findAll({ order: [['createdAt', 'DESC']] });
    const apiKeys = await ApiKey.findAll({ order: [['createdAt', 'DESC']] });
    
    // Calculer les statistiques pour le tableau de bord
    const totalKeys = apiKeys.length;
    const activeKeys = apiKeys.filter(key => key.isActive).length;
    const usageCount = apiKeys.reduce((sum, key) => sum + (key.usageCount || 0), 0);
    
    res.render('admin/dashboard', { 
      tips, 
      apiKeys,
      totalKeys,
      activeKeys,
      usageCount,
      messages: req.flash(),
      user: req.user
    });
  } catch (error) {
    logger.error(error);
    req.flash('error', 'Erreur serveur lors du chargement du tableau de bord');
    res.redirect('/admin');
  }
};

exports.createTip = async (req, res) => {
  try {
    await Tip.create({ content: req.body.content });
    req.flash('success', 'Astuce créée avec succès');
    res.redirect('/admin');
  } catch (error) {
    logger.error(error);
    req.flash('error', "Erreur lors de la création de l'astuce");
    res.redirect('/admin');
  }
};

exports.updateTip = async (req, res) => {
  try {
    await Tip.update({ content: req.body.content }, { 
      where: { id: req.params.id } 
    });
    req.flash('success', 'Astuce mise à jour avec succès');
    res.redirect('/admin');
  } catch (error) {
    logger.error(error);
    req.flash('error', "Erreur lors de la mise à jour de l'astuce");
    res.redirect('/admin');
  }
};

exports.deleteTip = async (req, res) => {
  try {
    await Tip.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Astuce supprimée avec succès');
    res.redirect('/admin');
  } catch (error) {
    logger.error(error);
    req.flash('error', "Erreur lors de la suppression de l'astuce");
    res.redirect('/admin');
  }
};

exports.generateApiKey = async (req, res) => {
  try {
    const key = generateReadableKey();
    const owner = req.body.owner || 'Anonyme';
    const duration = parseInt(req.body.duration) || 30; // Durée en jours
    
    // Calculer la date d'expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + duration);
    
    await ApiKey.create({ 
      key, 
      owner,
      expiresAt,
      isActive: true
    });
    
    req.flash('success', `Clé API générée: <strong>${key}</strong> pour ${owner}`);
  } catch (error) {
    logger.error(error);
    req.flash('error', "Erreur lors de la génération de la clé API");
  }
  res.redirect('/admin');
};

exports.revokeApiKey = async (req, res) => {
  try {
    await ApiKey.update({ isActive: false }, { 
      where: { id: req.params.id } 
    });
    req.flash('success', 'Clé API révoquée avec succès');
  } catch (error) {
    logger.error(error);
    req.flash('error', "Erreur lors de la révocation de la clé API");
  }
  res.redirect('/admin');
};

exports.activateApiKey = async (req, res) => {
  try {
    await ApiKey.update({ isActive: true }, { 
      where: { id: req.params.id } 
    });
    req.flash('success', 'Clé API activée avec succès');
  } catch (error) {
    logger.error(error);
    req.flash('error', "Erreur lors de l'activation de la clé API");
  }
  res.redirect('/admin');
};

exports.loginForm = (req, res) => {
  res.render('login', { messages: req.flash() });
};

exports.login = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', info.message);
      return res.redirect('/admin/login');
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.redirect('/admin');
    });
  })(req, res, next);
};

exports.logout = (req, res) => {
  req.logout();
  res.redirect('/');
};

// Fonction pour révoquer les clés expirées
exports.revokeExpiredKeys = async () => {
  try {
    const expiredKeys = await ApiKey.findAll({
      where: {
        expiresAt: { [Op.lt]: new Date() },
        isActive: true
      }
    });
    
    for (const key of expiredKeys) {
      await key.update({ isActive: false });
      logger.info(`Clé API expirée révoquée: ${key.key}`);
    }
    
    return expiredKeys.length;
  } catch (error) {
    logger.error('Erreur lors de la révocation des clés expirées: ' + error.message);
    return 0;
  }
};