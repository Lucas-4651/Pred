const express = require('express');
const router = express.Router();
const predictionController = require('../controllers/predictionController');
const { apiKeyAuth } = require('../middlewares/auth');

router.get('/predict', apiKeyAuth, predictionController.apiPredict);

module.exports = router;