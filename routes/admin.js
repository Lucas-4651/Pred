const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { ensureAuthenticated } = require('../middlewares/auth');

// Login routes
router.get('/login', adminController.loginForm);
router.post('/login', adminController.login);
router.get('/logout', adminController.logout);

// Dashboard
router.get('/', ensureAuthenticated, adminController.dashboard);

// Tips management
router.post('/tips', ensureAuthenticated, adminController.createTip);
router.post('/tips/:id', ensureAuthenticated, adminController.updateTip);
router.post('/tips/:id/delete', ensureAuthenticated, adminController.deleteTip);

// API Keys management
router.post('/keys/generate', ensureAuthenticated, adminController.generateApiKey);
router.post('/keys/:id/revoke', ensureAuthenticated, adminController.revokeApiKey);
router.post('/keys/:id/activate', ensureAuthenticated, adminController.activateApiKey);

module.exports = router;