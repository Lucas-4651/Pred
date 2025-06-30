const Tip = require('../models/Tip');
const logger = require('../middlewares/logger');

exports.showTips = async (req, res) => {
  try {
    const tips = await Tip.findAll({
      order: [['createdAt', 'DESC']]
    });
    
    res.render('tips', { 
      tips,
      user: req.user // Ajouter cette ligne
    });
  } catch (error) {
    logger.error('Erreur lors de la récupération des astuces: ' + error.message);
    res.status(500).render('error', { 
      message: "Erreur lors du chargement des astuces",
      user: req.user // Ajouter cette ligne
    });
  }
};