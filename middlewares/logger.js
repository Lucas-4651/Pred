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

// Mode debug toujours actif
const isDebugEnabled = true;

// Codes couleurs ANSI
const colors = {
    reset: '\x1b[0m',
    info: '\x1b[32m',    // Vert
    error: '\x1b[31m',   // Rouge
    warn: '\x1b[33m',    // Jaune
    debug: '\x1b[36m',   // Cyan
    timestamp: '\x1b[90m' // Gris pour le timestamp (optionnel)
};

const logger = {
    info: (message, ...args) => {
        const formattedMessage = util.format(message, ...args);
        const timestamp = new Date().toISOString();
        
        // Version colorée pour le terminal
        const terminalLog = `${colors.info}[INFO]${colors.reset} ${colors.timestamp}${timestamp}${colors.reset} - ${formattedMessage}\n`;
        process.stdout.write(terminalLog);
        
        // Version sans couleur pour le fichier
        const fileLog = `[INFO] ${timestamp} - ${formattedMessage}\n`;
        logStream.write(fileLog);
    },
    
    error: (message, ...args) => {
        const formattedMessage = util.format(message, ...args);
        const timestamp = new Date().toISOString();
        
        // Version colorée pour le terminal
        const terminalLog = `${colors.error}[ERROR]${colors.reset} ${colors.timestamp}${timestamp}${colors.reset} - ${formattedMessage}\n`;
        process.stderr.write(terminalLog);
        
        // Version sans couleur pour le fichier
        const fileLog = `[ERROR] ${timestamp} - ${formattedMessage}\n`;
        logStream.write(fileLog);
    },
    
    warn: (message, ...args) => {
        const formattedMessage = util.format(message, ...args);
        const timestamp = new Date().toISOString();
        
        // Version colorée pour le terminal
        const terminalLog = `${colors.warn}[WARN]${colors.reset} ${colors.timestamp}${timestamp}${colors.reset} - ${formattedMessage}\n`;
        process.stderr.write(terminalLog);
        
        // Version sans couleur pour le fichier
        const fileLog = `[WARN] ${timestamp} - ${formattedMessage}\n`;
        logStream.write(fileLog);
    },
    
    debug: (message, ...args) => {
        const formattedMessage = util.format(message, ...args);
        const timestamp = new Date().toISOString();
        
        // Version colorée pour le terminal
        const terminalLog = `${colors.debug}[DEBUG]${colors.reset} ${colors.timestamp}${timestamp}${colors.reset} - ${formattedMessage}\n`;
        process.stdout.write(terminalLog);
        
        // Version sans couleur pour le fichier
        const fileLog = `[DEBUG] ${timestamp} - ${formattedMessage}\n`;
        logStream.write(fileLog);
    }
};

module.exports = logger;