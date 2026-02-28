#!/usr/bin/env node

/**
 * Database Explorer pour VFL
 * Usage: node db-explorer.js [commande]
 * 
 * Commandes:
 *   tables        - Liste toutes les tables
 *   stats         - Statistiques générales
 *   predictions   - Dernières prédictions
 *   ratings       - Classement Elo
 *   learning      - État d'apprentissage
 *   tips          - Derniers tips
 *   users         - Liste des utilisateurs
 *   api-keys      - Clés API
 *   analyze       - Analyse complète
 *   sql "query"   - Exécute une requête SQL personnalisée
 *   export        - Exporte les données en JSON
 */

const { Sequelize } = require('sequelize');
require('dotenv').config();

// Configuration
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: false
});

// Couleurs pour console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function logTitle(title) {
  console.log('\n' + colors.bright + colors.cyan + '═'.repeat(60) + colors.reset);
  console.log(colors.bright + colors.yellow + `  ${title}` + colors.reset);
  console.log(colors.bright + colors.cyan + '═'.repeat(60) + colors.reset);
}

function logSubtitle(title) {
  console.log('\n' + colors.bright + colors.green + `▶ ${title}` + colors.reset);
  console.log(colors.dim + '─'.repeat(40) + colors.reset);
}

function logSuccess(msg) {
  console.log(colors.green + '✓ ' + colors.reset + msg);
}

function logError(msg) {
  console.log(colors.red + '✗ ' + colors.reset + msg);
}

function logInfo(msg) {
  console.log(colors.blue + 'ℹ ' + colors.reset + msg);
}

function logData(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function listTables() {
  logTitle('📊 Tables de la base de données');
  
  const [results] = await sequelize.query(`
    SELECT 
      table_name,
      pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size,
      (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as columns
    FROM information_schema.tables t
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  console.table(results.map(r => ({
    Table: r.table_name,
    Colonnes: r.columns,
    Taille: r.size || 'petite'
  })));
}

async function getStats() {
  logTitle('📈 Statistiques générales');
  
  // Comptage pour chaque table
  const tables = ['Predictions', 'Ratings', 'LearningStates', 'Tips', 'Users', 'ApiKeys'];
  
  for (const table of tables) {
    try {
      const [count] = await sequelize.query(`SELECT COUNT(*) as count FROM "${table}"`);
      console.log(`${colors.cyan}${table.padEnd(15)}${colors.reset} : ${count[0].count} enregistrements`);
    } catch (e) {
      // Table peut ne pas exister
    }
  }
  
  // Stats prédictions
  try {
    const [predStats] = await sequelize.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN actual_result IS NOT NULL THEN 1 END) as realises,
        COUNT(CASE WHEN prediction = actual_result THEN 1 END) as corrects,
        ROUND(AVG(confidence)) as conf_moyenne,
        MIN("createdAt") as premier,
        MAX("createdAt") as dernier
      FROM "Predictions"
    `);
    
    logSubtitle('Précision des prédictions');
    const stats = predStats[0];
    console.log(`Total: ${stats.total}`);
    console.log(`Réalisés: ${stats.realises}`);
    if (stats.realises > 0) {
      const accuracy = (stats.corrects / stats.realises * 100).toFixed(1);
      console.log(`Corrects: ${stats.corrects} (${accuracy}%)`);
    }
    console.log(`Confiance moyenne: ${stats.conf_moyenne}%`);
    console.log(`Première: ${new Date(stats.premier).toLocaleString()}`);
    console.log(`Dernière: ${new Date(stats.dernier).toLocaleString()}`);
  } catch (e) {
    logError('Erreur stats prédictions: ' + e.message);
  }
  
  // Top équipes Elo
  try {
    const [topTeams] = await sequelize.query(`
      SELECT team, rating, games 
      FROM "Ratings" 
      ORDER BY rating DESC 
      LIMIT 5
    `);
    
    if (topTeams.length > 0) {
      logSubtitle('🏆 Top 5 équipes Elo');
      console.table(topTeams);
    }
  } catch (e) {}
}

async function showPredictions(limit = 10) {
  logTitle('⚽ Dernières prédictions');
  
  try {
    const [predictions] = await sequelize.query(`
      SELECT 
        id,
        match,
        prediction,
        confidence,
        goals,
        exact_score,
        actual_result,
        actual_score,
        "createdAt"
      FROM "Predictions" 
      ORDER BY "createdAt" DESC 
      LIMIT ${limit}
    `);
    
    if (predictions.length === 0) {
      logInfo('Aucune prédiction trouvée');
      return;
    }
    
    predictions.forEach(p => {
      const status = p.actual_result 
        ? (p.prediction === p.actual_result ? colors.green + '✓' : colors.red + '✗') 
        : colors.yellow + '⏳';
      
      console.log(
        colors.reset + p.id.toString().padEnd(4),
        status + colors.reset,
        p.match.padEnd(25),
        colors.cyan + p.prediction + colors.reset,
        '/',
        p.actual_result || '?',
        colors.dim + `[${p.confidence}%]` + colors.reset,
        p.exact_score,
        p.actual_score ? `→ ${p.actual_score}` : '',
        colors.dim + new Date(p.createdAt).toLocaleDateString() + colors.reset
      );
    });
    
    // Stats rapides
    const correct = predictions.filter(p => p.actual_result && p.prediction === p.actual_result).length;
    const total = predictions.filter(p => p.actual_result).length;
    if (total > 0) {
      console.log(colors.dim + `\nPrécision récente: ${(correct/total*100).toFixed(1)}% (${correct}/${total})` + colors.reset);
    }
    
  } catch (e) {
    logError('Erreur: ' + e.message);
  }
}

async function showRatings() {
  logTitle('📊 Classement Elo');
  
  try {
    const [ratings] = await sequelize.query(`
      SELECT team, rating, games,
        RANK() OVER (ORDER BY rating DESC) as rang
      FROM "Ratings" 
      ORDER BY rating DESC
    `);
    
    if (ratings.length === 0) {
      logInfo('Aucun rating trouvé');
      return;
    }
    
    console.table(ratings.map(r => ({
      '#': r.rang,
      Équipe: r.team,
      Elo: r.rating,
      Matchs: r.games
    })));
    
    // Stats
    const avg = ratings.reduce((acc, r) => acc + r.rating, 0) / ratings.length;
    console.log(colors.dim + `Moyenne: ${Math.round(avg)} | Total équipes: ${ratings.length}` + colors.reset);
    
  } catch (e) {
    logError('Erreur: ' + e.message);
  }
}

async function showLearning() {
  logTitle('🧠 État apprentissage VFL');
  
  try {
    const [states] = await sequelize.query(`
      SELECT 
        id,
        weights,
        metrics,
        "homeAdvantageBase",
        "learningRates",
        "createdAt"
      FROM "LearningStates" 
      ORDER BY "createdAt" DESC 
      LIMIT 3
    `);
    
    if (states.length === 0) {
      logInfo('Aucun état d\'apprentissage trouvé');
      return;
    }
    
    states.forEach((state, i) => {
      logSubtitle(`Snapshot #${state.id} - ${new Date(state.createdAt).toLocaleString()}`);
      
      if (state.weights) {
        console.log('Poids:', state.weights);
      }
      
      if (state.metrics) {
        console.log('Métriques:', {
          accuracy: (state.metrics.accuracy * 100).toFixed(1) + '%',
          predictions: state.metrics.totalPredictions,
          goalAccuracy: state.metrics.goalAccuracy ? (state.metrics.goalAccuracy * 100).toFixed(1) + '%' : 'N/A'
        });
      }
      
      if (state.homeAdvantageBase) {
        console.log(`Avantage domicile: ${(state.homeAdvantageBase * 100).toFixed(1)}%`);
      }
    });
    
  } catch (e) {
    logError('Erreur: ' + e.message);
  }
}

async function showTips(limit = 5) {
  logTitle('💡 Derniers tips');
  
  try {
    const [tips] = await sequelize.query(`
      SELECT * FROM "Tips" 
      ORDER BY "createdAt" DESC 
      LIMIT ${limit}
    `);
    
    if (tips.length === 0) {
      logInfo('Aucun tip trouvé');
      return;
    }
    
    console.table(tips);
    
  } catch (e) {
    // Table peut ne pas exister
    logInfo('Table Tips non trouvée');
  }
}

async function showUsers() {
  logTitle('👥 Utilisateurs');
  
  try {
    const [users] = await sequelize.query(`
      SELECT id, email, role, "createdAt" 
      FROM "Users" 
      ORDER BY "createdAt" DESC 
      LIMIT 10
    `);
    
    if (users.length === 0) {
      logInfo('Aucun utilisateur trouvé');
      return;
    }
    
    console.table(users);
    
  } catch (e) {
    logInfo('Table Users non trouvée');
  }
}

async function showApiKeys() {
  logTitle('🔑 Clés API');
  
  try {
    const [keys] = await sequelize.query(`
      SELECT id, name, "createdAt" 
      FROM "ApiKeys" 
      ORDER BY "createdAt" DESC
    `);
    
    if (keys.length === 0) {
      logInfo('Aucune clé API trouvée');
      return;
    }
    
    console.table(keys);
    
  } catch (e) {
    logInfo('Table ApiKeys non trouvée');
  }
}

async function analyzeDatabase() {
  logTitle('🔍 Analyse complète de la base');
  
  await getStats();
  await showPredictions(5);
  await showRatings();
  await showLearning();
  
  // Analyse des colonnes
  logSubtitle('Structure des tables');
  
  const tables = ['Predictions', 'Ratings', 'LearningStates'];
  for (const table of tables) {
    try {
      const [columns] = await sequelize.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = '${table}'
        ORDER BY ordinal_position
      `);
      
      console.log(`\n${colors.cyan}${table}${colors.reset} (${columns.length} colonnes)`);
      columns.slice(0, 5).forEach(col => {
        console.log(`  ${col.column_name.padEnd(20)} ${col.data_type} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      if (columns.length > 5) {
        console.log(`  ... et ${columns.length - 5} autres colonnes`);
      }
    } catch (e) {}
  }
}

async function exportToJson(table) {
  logTitle(`📤 Export de ${table}`);
  
  try {
    const [data] = await sequelize.query(`SELECT * FROM "${table}"`);
    const filename = `export-${table}-${Date.now()}.json`;
    
    require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
    logSuccess(`Exporté vers ${filename} (${data.length} lignes)`);
    
  } catch (e) {
    logError(`Erreur export: ${e.message}`);
  }
}

async function executeCustomSQL(query) {
  logTitle('🔧 Requête SQL personnalisée');
  
  try {
    console.log(colors.dim + query + colors.reset + '\n');
    const [results] = await sequelize.query(query);
    
    if (Array.isArray(results) && results.length > 0) {
      console.table(results.slice(0, 20));
      if (results.length > 20) {
        logInfo(`+ ${results.length - 20} résultats supplémentaires`);
      }
    } else {
      console.log('Aucun résultat');
    }
    
    if (results.length === 0) {
      console.log('Requête exécutée avec succès (0 ligne)');
    }
    
  } catch (e) {
    logError(`Erreur SQL: ${e.message}`);
  }
}

// Menu interactif
async function showInteractiveMenu() {
  console.clear();
  logTitle('🛠️  Database Explorer VFL');
  console.log(`
  ${colors.cyan}1.${colors.reset} 📊 Voir toutes les tables
  ${colors.cyan}2.${colors.reset} 📈 Statistiques générales
  ${colors.cyan}3.${colors.reset} ⚽ Dernières prédictions
  ${colors.cyan}4.${colors.reset} 🏆 Classement Elo
  ${colors.cyan}5.${colors.reset} 🧠 État apprentissage
  ${colors.cyan}6.${colors.reset} 👥 Utilisateurs
  ${colors.cyan}7.${colors.reset} 💡 Tips
  ${colors.cyan}8.${colors.reset} 🔑 Clés API
  ${colors.cyan}9.${colors.reset} 🔍 Analyse complète
  ${colors.cyan}10.${colors.reset} 💾 Exporter (Predictions/Ratings/Learning)
  ${colors.cyan}11.${colors.reset} 🔧 SQL personnalisé
  ${colors.cyan}0.${colors.reset} 🚪 Quitter
  `);
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  readline.question('Choix: ', async (choice) => {
    readline.close();
    
    switch(choice) {
      case '1': await listTables(); break;
      case '2': await getStats(); break;
      case '3': await showPredictions(); break;
      case '4': await showRatings(); break;
      case '5': await showLearning(); break;
      case '6': await showUsers(); break;
      case '7': await showTips(); break;
      case '8': await showApiKeys(); break;
      case '9': await analyzeDatabase(); break;
      case '10': 
        const rl = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.question('Table (Predictions/Ratings/LearningStates): ', async (table) => {
          rl.close();
          await exportToJson(table);
        });
        return;
      case '11':
        const sqlRl = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        sqlRl.question('SQL: ', async (query) => {
          sqlRl.close();
          await executeCustomSQL(query);
        });
        return;
      case '0':
        console.log('Au revoir !');
        process.exit(0);
      default:
        logError('Choix invalide');
    }
    
    // Retour au menu
    setTimeout(() => {
      showInteractiveMenu();
    }, 2000);
  });
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'menu';
  
  try {
    await sequelize.authenticate();
    
    switch(command) {
      case 'tables': await listTables(); break;
      case 'stats': await getStats(); break;
      case 'predictions': await showPredictions(args[1] ? parseInt(args[1]) : 10); break;
      case 'ratings': await showRatings(); break;
      case 'learning': await showLearning(); break;
      case 'tips': await showTips(); break;
      case 'users': await showUsers(); break;
      case 'api-keys': await showApiKeys(); break;
      case 'analyze': await analyzeDatabase(); break;
      case 'export': await exportToJson(args[1]); break;
      case 'sql': 
        if (args[1]) {
          await executeCustomSQL(args.slice(1).join(' '));
        } else {
          logError('Spécifiez une requête SQL');
        }
        break;
      case 'menu':
      default:
        await showInteractiveMenu();
        break;
    }
    
    if (command !== 'menu') {
      await sequelize.close();
    }
    
  } catch (error) {
    logError('Erreur de connexion: ' + error.message);
    process.exit(1);
  }
}

// Gestion CTRL+C
process.on('SIGINT', () => {
  console.log('\nAu revoir !');
  process.exit();
});

// Lancer le programme
if (require.main === module) {
  main();
}

module.exports = {
  listTables,
  getStats,
  showPredictions,
  showRatings,
  showLearning
};