require('dotenv').config();
const sequelize = require('./config/database');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Tip = require('./models/Tip');
const ApiKey = require('./models/ApiKey');

async function initializeDatabase() {
  try {
    // Synchroniser tous les modèles (SANS supprimer les données)
    await sequelize.sync({ alter: true });
    console.log('✅ Tables synchronisées avec succès');

    // Vérifier si admin déjà existant
    const existingAdmin = await User.findOne({ where: { username: process.env.ADMIN_USERNAME } });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      const admin = await User.create({
        username: process.env.ADMIN_USERNAME,
        password: hashedPassword
      });
      console.log('👑 Admin créé:', admin.username);
    } else {
      console.log('🔐 Admin déjà existant');
    }

    // Ajouter des astuces si la table est vide
    const tipsCount = await Tip.count();
    if (tipsCount === 0) {
      const tips = await Tip.bulkCreate([
        { content: "Consultez les statistiques des équipes avant de parier" },
        { content: "Les matchs à domicile ont souvent un avantage significatif" },
        { content: "Analysez les dernières performances plutôt que la saison complète" }
      ]);
      console.log(`💡 ${tips.length} astuces créées`);
    }

    // Créer une clé API par défaut si vide
    const apiKeyCount = await ApiKey.count();
    if (apiKeyCount === 0) {
      const apiKey = await ApiKey.create({
        key: 'Lucas_production',
        owner: 'Admin'
      });
      console.log('🔑 Clé API par défaut créée:', apiKey.key);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    process.exit(1);
  }
}

initializeDatabase();