const express = require('express');
const router = express.Router();
const predictionController = require('../controllers/predictionController');
const tipController = require('../controllers/tipController');
const fs = require('fs');
const path = require('path');
const Download = require('../models/Download');

// Routes publiques
router.get('/', predictionController.predict);
router.get('/tips', tipController.showTips);

// GET page download : affiche seulement
router.get('/download', async (req, res) => {
  try {
    const apkPath = path.join(__dirname, '../public/apk/VirtualMG_v1.0.apk');
    const stats = fs.statSync(apkPath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    const record = await Download.findByPk(1);

    res.render('download', {
      downloadCount: record ? record.count : 0,
      fileSize: sizeInMB
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur lors de l'affichage");
  }
});

// POST pour téléchargement réel + incrément
router.post('/download/apk', async (req, res) => {
  try {
    const apkPath = path.join(__dirname, '../public/apk/VirtualMG_v1.0.apk');

    // ⚡ Incrémente uniquement sur vrai clic
    await Download.increment('count', { by: 1, where: { id: 1 } });

    res.download(apkPath);
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur téléchargement");
  }
});
module.exports = router;