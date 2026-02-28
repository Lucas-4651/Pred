process.removeAllListeners('warning');

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const passport = require('passport');
require('./config/passport');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const flash = require('express-flash');
const logger = require('./middlewares/logger');
const adminController = require('./controllers/adminController');
const User = require('./models/User');
const Download = require('./models/Download');
const sequelize = require('./config/database');

const app = express();

/* ===============================
   CONNEXION DATABASE + INIT
================================ */

(async () => {
  try {

    await sequelize.authenticate();
    logger.info('Connexion à Psql neon établie.');

    await sequelize.sync();

    // Création du compteur download si absent
    await Download.findOrCreate({
      where: { id: 1 },
      defaults: { count: 0 }
    });

    // Création user test en dev
    if (process.env.NODE_ENV === 'development') {
      const userCount = await User.count();
      if (userCount === 0) {
        await User.create({
          username: 'Lucas',
          password: 'Lucas2K24'
        });
        logger.info('Utilisateur test créé');
      }
    }

  } catch (err) {
    logger.error('Erreur Psql: ' + err);
  }
})();

/* ===============================
   MIDDLEWARES
================================ */

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

/* ===============================
   SESSION CONFIG
================================ */

const sessionStore = new FileStore({
  path: path.join(__dirname, 'sessions'),
  ttl: 24 * 60 * 60,
  retries: 1,
  logFn: (message) => logger.info(`[Session] ${message}`)
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.messages = req.flash();
  res.locals.copyright = "Lucas46Modder Madagascar 2026";
  next();
});

/* ===============================
   RATE LIMIT
================================ */

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.'
});
app.use('/api/', apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives de connexion depuis cette IP.'
});
app.use('/admin/login', loginLimiter);

/* ===============================
   ROUTES
================================ */

app.use('/', require('./routes/web'));
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));

/* ===============================
   ERROR HANDLER
================================ */

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).render('error', { 
    message: 'Erreur serveur',
    user: req.user
  });
});

/* ===============================
   SERVER START
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Serveur démarré sur le port ${PORT}`);
  
  if (process.env.NODE_ENV === 'development') {
    logger.info('Mode développement actif');
    logger.info('Utilisateur test');
  }
});

/* ===============================
   DAILY CRON
================================ */

setInterval(async () => {
  try {
    const revokedCount = await adminController.revokeExpiredKeys();
    if (revokedCount > 0) {
      logger.info(`${revokedCount} clés API expirées ont été révoquées`);
    }
  } catch (err) {
    logger.error('Erreur revokeExpiredKeys: ' + err);
  }
}, 24 * 60 * 60 * 1000);