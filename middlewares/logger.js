const fs = require('fs');
const path = require('path');
const util = require('util');

// Créer le dossier logs s'il n'existe pas
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logFile = path.join(logDir, 'app.log');

// Créer un flux d'écriture pour les logs
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

const logger = {
    info: (message, ...args) => {
        const formattedMessage = util.format(message, ...args);
        const log = `[INFO] ${new Date().toISOString()} - ${formattedMessage}\n`;
        process.stdout.write(log);
        logStream.write(log);
    },
    error: (message, ...args) => {
        const formattedMessage = util.format(message, ...args);
        const log = `[ERROR] ${new Date().toISOString()} - ${formattedMessage}\n`;
        process.stderr.write(log);
        logStream.write(log);
    },
    warn: (message, ...args) => {
        const formattedMessage = util.format(message, ...args);
        const log = `[WARN] ${new Date().toISOString()} - ${formattedMessage}\n`;
        process.stderr.write(log);
        logStream.write(log);
    }
};

module.exports = logger;