const { Sequelize } = require('sequelize');

// Configuration avec gestion d'erreur et retry
let sequelize;

function createSequelizeInstance() {
  return new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Nécessaire pour Neon
      }
    },
    pool: {
      max: 5,
      min: 1,
      acquire: 30000,
      idle: 10000
    },
    retry: {
      max: 3
    }
  });
}

// Tentative de connexion avec retry
async function initializeDatabase() {
  let attempts = 0;
  const maxAttempts = 5;
  
  while (attempts < maxAttempts) {
    try {
      attempts++;
      sequelize = createSequelizeInstance();
      await sequelize.authenticate();
      console.log('[DB] Connexion réussie');
      return sequelize;
    } catch (error) {
      console.error(`[DB] Échec connexion (tentative ${attempts}/${maxAttempts}):`, error.message);
      
      if (attempts === maxAttempts) {
        console.error('[DB] Échec critique - arrêt du serveur');
        process.exit(1);
      }
      
      // Attente exponentielle: 1s, 2s, 4s, 8s...
      const waitTime = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Gestionnaire de déconnexion
process.on('SIGINT', async () => {
  if (sequelize) {
    await sequelize.close();
    console.log('[DB] Connexion fermée proprement');
  }
  process.exit(0);
});

// Initialisation immédiate
initializeDatabase();

module.exports = sequelize;