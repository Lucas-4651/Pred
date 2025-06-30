const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/User');
const bcrypt = require('bcryptjs');

passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const user = await User.findOne({ where: { username } });
      if (!user) {
        return done(null, false, { message: 'Utilisateur non trouvé.' });
      }
      
      bcrypt.compare(password, user.password, (err, isValid) => {
        if (err) return done(err);
        if (!isValid) {
          return done(null, false, { message: 'Mot de passe incorrect.' });
        }
        return done(null, user);
      });
    } catch (error) {
      return done(error);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});