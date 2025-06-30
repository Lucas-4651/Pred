const express = require('express');
const router = express.Router();
const predictionController = require('../controllers/predictionController');
const tipController = require('../controllers/tipController');

router.get('/', predictionController.predict);
router.get('/tips', tipController.showTips);

module.exports = router;