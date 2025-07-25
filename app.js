process.removeAllListeners('warning');

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session); // Solution alternative fiable
const path = require('path');
const passport = require('passport');
require('./config/passport');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const flash = require('express-flash');
const logger = require('./middlewares/logger');
const adminController = require('./controllers/adminController');
const User = require('./models/User');

const app = express();

// Configuration de SQLite
const sequelize = require('./config/database');

// Tester la connexion et synchroniser les modèles
sequelize.authenticate()
  .then(() => {
    logger.info('Connexion à SQLite établie.');
    return sequelize.sync();
  })
  .then(async () => {
    if (process.env.NODE_ENV === 'development') {
      const userCount = await User.count();
      if (userCount === 0) {
        await User.create({
          username: 'Lucas',
          password: 'Lucas2K24'
        });
        logger.info('Utilisateur test créé (testadmin / testpassword)');
      }
    }
  })
  .catch(err => {
    logger.error('Erreur SQLite: ' + err);
  });

// Middlewares
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// SOLUTION FONCTIONNELLE : Configuration du store de session avec fichiers
const sessionStore = new FileStore({
  path: path.join(__dirname, 'sessions'), // Dossier où stocker les sessions
  ttl: 24 * 60 * 60, // Durée de vie en secondes (24h)
  retries: 1,
  logFn: (message) => logger.info(`[Session] ${message}`) // Log des opérations sur les sessions
});

// Configuration de session
app.use(session({
  store: sessionStore, // Utilisation du store fichier
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24h
  }
}));

// Flash messages
app.use(flash());

// Initialisation de Passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware pour passer les variables aux vues
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.messages = req.flash();
  res.locals.copyright = "Lucas46Modder Madagascar 2025";
  next();
});

// Limitation de débit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.'
});
app.use('/api/', apiLimiter);

// Protection contre les tentatives de login répétées
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives max
  message: 'Trop de tentatives de connexion, veuillez réessayer plus tard.'
});
app.use('/admin/login', loginLimiter);

// Routes
app.use('/', require('./routes/web'));
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));

// Middleware d'erreur
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).render('error', { 
    message: 'Erreur serveur',
    user: req.user
  });
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Serveur démarré sur le port ${PORT}`);
  
  // Avertissement en développement
  if (process.env.NODE_ENV === 'development') {
    logger.info('Mode développement actif');
    logger.info('Utilisateur test: testadmin / testpassword');
  }
});

// Planifier la vérification quotidienne des clés expirées
setInterval(async () => {
  const revokedCount = await adminController.revokeExpiredKeys();
  if (revokedCount > 0) {
    logger.info(`${revokedCount} clés API expirées ont été révoquées`);
  }
}, 24 * 60 * 60 * 1000); // Tous les jours