// utils/autoAnalyzer.js - VERSION CORRIGÉE (logger.debug fix)
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Créer un logger simple si non existant
function createSimpleLogger() {
    return {
        info: (...args) => console.log('[INFO]', ...args),
        error: (...args) => console.error('[ERROR]', ...args),
        warn: (...args) => console.warn('[WARN]', ...args),
        debug: (...args) => {
            if (process.env.NODE_ENV === 'development') {
                console.debug('[DEBUG]', ...args);
            }
        }
    };
}

// Utiliser le logger existant ou créer un simple
let logger;
try {
    logger = require('../middlewares/logger');
    // Vérifier si logger a la méthode debug
    if (typeof logger.debug !== 'function') {
        logger.debug = (...args) => {
            if (process.env.NODE_ENV === 'development') {
                console.debug('[DEBUG]', ...args);
            }
        };
    }
} catch (error) {
    logger = createSimpleLogger();
}

class AutoAnalyzer {
    constructor() {
        this.resultsUrl = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/results?skip=0&take=200";
        this.predictionsPath = path.join(__dirname, '../data/predictions_log.json');
        this.performancePath = path.join(__dirname, '../data/performance_history.json');
        this.patternsPath = path.join(__dirname, '../data/patterns_detected.json');
        
        this.HEADERS = {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10)",
            "App-Version": "27869",
            "Origin": "https://bet261.mg",
            "Referer": "https://bet261.mg/"
        };
        
        this.TEAM_MAPPING = {
            'C. Palace': 'Crystal Palace',
            'N. Forest': 'Nottingham Forest', 
            'A. Villa': 'Aston Villa',
            'Manchester Red': 'Manchester United',
            'Manchester Blue': 'Manchester City',
            'London Reds': 'Chelsea',
            'London Blues': 'Arsenal',
            'Spurs': 'Tottenham',
            'Wolverhampton': 'Wolves',
            'Brighton': 'Brighton',
            'Leicester': 'Leicester',
            'Newcastle': 'Newcastle',
            'West Ham': 'West Ham',
            'Bournemouth': 'Bournemouth',
            'Brentford': 'Brentford',
            'Fulham': 'Fulham',
            'Leeds': 'Leeds',
            'Everton': 'Everton',
            'Southampton': 'Southampton',
            'Ipswich': 'Ipswich',
            'Burnley': 'Burnley',
            'Sunderland': 'Sunderland',
            'Liverpool': 'Liverpool'
        };
        
        this.init();
    }
    
    init() {
        // Créer les fichiers si inexistants
        [this.predictionsPath, this.performancePath, this.patternsPath].forEach(filePath => {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (!fs.existsSync(filePath)) {
                const initialData = filePath === this.predictionsPath ? [] : {};
                fs.writeFileSync(filePath, JSON.stringify(initialData));
            }
        });
    }
    
    async run() {
        try {
            logger.info('🔄 Démarrage analyse automatique...');
            
            // 1. Récupérer les résultats finaux
            const finalResults = await this.fetchFinalResults();
            if (!finalResults || finalResults.length === 0) {
                logger.warn('⚠️ Aucun résultat disponible pour analyse');
                return { updated: 0, correct: 0, accuracy: 0 };
            }
            
            // 2. Charger les prédictions en attente
            const pendingPredictions = this.loadPendingPredictions();
            if (pendingPredictions.length === 0) {
                logger.info('✅ Aucune prédiction en attente');
                return { updated: 0, correct: 0, accuracy: 0 };
            }
            
            logger.info(`📊 Analyse de ${pendingPredictions.length} prédictions vs ${finalResults.length} résultats`);
            
            // 3. Comparer et mettre à jour
            const updates = await this.intelligentMatchAndUpdate(pendingPredictions, finalResults);
            
            // 4. Sauvegarder et analyser
            if (updates.updated > 0) {
                await this.analyzePerformance();
                this.detectPatterns();
                
                logger.info(`✅ Analyse terminée: ${updates.updated} matchs mis à jour, ${updates.correct} corrects (${updates.accuracy}%)`);
            } else {
                logger.info('ℹ️ Aucun match mis à jour');
            }
            
            return updates;
            
        } catch (error) {
            logger.error(`❌ Erreur analyse automatique: ${error.message}`);
            return { updated: 0, correct: 0, accuracy: 0, error: error.message };
        }
    }
    
    async fetchFinalResults() {
        try {
            logger.info(`🌐 Récupération résultats depuis: ${this.resultsUrl}`);
            
            const response = await axios.get(this.resultsUrl, {
                headers: this.HEADERS,
                timeout: 10000
            });
            
            if (!response.data || !response.data.rounds) {
                logger.warn('⚠️ Aucune donnée dans la réponse API');
                return [];
            }
            
            // Extraire les matchs terminés
            const allMatches = [];
            
            response.data.rounds.forEach(round => {
                if (round.matches && Array.isArray(round.matches)) {
                    round.matches.forEach(match => {
                        if (match.goals && match.goals.length > 0) {
                            const lastGoal = match.goals[match.goals.length - 1];
                            
                            allMatches.push({
                                homeTeam: match.homeTeam.name,
                                awayTeam: match.awayTeam.name,
                                homeScore: lastGoal.homeScore,
                                awayScore: lastGoal.awayScore,
                                result: this.getResultFromScore(lastGoal.homeScore, lastGoal.awayScore),
                                timestamp: match.date || new Date().toISOString()
                            });
                        }
                    });
                }
            });
            
            logger.info(`📥 ${allMatches.length} résultats finaux récupérés`);
            
            // Trier par date (plus récents en premier)
            allMatches.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Prendre les 50 plus récents
            return allMatches.slice(0, 50);
            
        } catch (error) {
            logger.error(`❌ Erreur récupération résultats: ${error.message}`);
            return [];
        }
    }
    
    getResultFromScore(homeScore, awayScore) {
        if (homeScore > awayScore) return '1';
        if (homeScore === awayScore) return 'X';
        return '2';
    }
    
    loadPendingPredictions() {
        try {
            if (!fs.existsSync(this.predictionsPath)) {
                return [];
            }
            
            const content = fs.readFileSync(this.predictionsPath, 'utf8');
            if (!content.trim()) {
                return [];
            }
            
            const data = JSON.parse(content);
            const pending = data.filter(p => 
                p.actual_result === null || 
                p.actual_result === undefined || 
                p.actual_result === ''
            );
            
            logger.info(`📋 ${pending.length} prédictions en attente sur ${data.length} totales`);
            return pending;
            
        } catch (error) {
            logger.error(`❌ Erreur chargement prédictions: ${error.message}`);
            return [];
        }
    }
    
    async intelligentMatchAndUpdate(predictions, results) {
        let updated = 0;
        let correct = 0;
        
        try {
            // Charger toutes les prédictions
            const allPredictions = JSON.parse(fs.readFileSync(this.predictionsPath, 'utf8'));
            
            // Pour chaque prédiction en attente
            for (const prediction of predictions) {
                const [predHome, predAway] = prediction.match.split(' vs ');
                
                // Chercher le résultat correspondant
                let matchedResult = null;
                
                // Essayer plusieurs stratégies
                matchedResult = this.findExactMatch(predHome, predAway, results);
                
                if (!matchedResult) {
                    matchedResult = this.findReverseMatch(predHome, predAway, results);
                }
                
                if (!matchedResult) {
                    matchedResult = this.findSimilarMatch(predHome, predAway, results);
                }
                
                if (matchedResult) {
                    // Trouver l'index de la prédiction
                    const predIndex = allPredictions.findIndex(p => p.match_id === prediction.match_id);
                    
                    if (predIndex !== -1) {
                        // Mettre à jour la prédiction
                        allPredictions[predIndex].actual_result = matchedResult.result;
                        allPredictions[predIndex].actual_score = `${matchedResult.homeScore}-${matchedResult.awayScore}`;
                        allPredictions[predIndex].is_correct = (allPredictions[predIndex].prediction === matchedResult.result);
                        allPredictions[predIndex].updated_at = new Date().toISOString();
                        allPredictions[predIndex].auto_updated = true;
                        
                        updated++;
                        if (allPredictions[predIndex].is_correct) correct++;
                        
                        logger.info(`✅ ${prediction.match}: ${prediction.prediction} → ${matchedResult.result} ${allPredictions[predIndex].is_correct ? '✓' : '✗'}`);
                        
                        // Retirer ce résultat pour éviter les doublons
                        const resultIndex = results.findIndex(r => 
                            r.homeTeam === matchedResult.homeTeam && 
                            r.awayTeam === matchedResult.awayTeam
                        );
                        if (resultIndex !== -1) {
                            results.splice(resultIndex, 1);
                        }
                    }
                }
            }
            
            // Sauvegarder les mises à jour
            if (updated > 0) {
                fs.writeFileSync(this.predictionsPath, JSON.stringify(allPredictions, null, 2));
                logger.info(`💾 ${updated} prédictions mises à jour`);
            }
            
            return {
                updated,
                correct,
                accuracy: updated > 0 ? ((correct / updated) * 100).toFixed(1) : 0
            };
            
        } catch (error) {
            logger.error(`❌ Erreur matching: ${error.message}`);
            return { updated: 0, correct: 0, accuracy: 0 };
        }
    }
    
    findExactMatch(predHome, predAway, results) {
        const normPredHome = this.normalizeTeamName(predHome);
        const normPredAway = this.normalizeTeamName(predAway);
        
        return results.find(r => {
            const normResultHome = this.normalizeTeamName(r.homeTeam);
            const normResultAway = this.normalizeTeamName(r.awayTeam);
            
            return normPredHome === normResultHome && normPredAway === normResultAway;
        });
    }
    
    findReverseMatch(predHome, predAway, results) {
        const normPredHome = this.normalizeTeamName(predHome);
        const normPredAway = this.normalizeTeamName(predAway);
        
        return results.find(r => {
            const normResultHome = this.normalizeTeamName(r.homeTeam);
            const normResultAway = this.normalizeTeamName(r.awayTeam);
            
            return normPredHome === normResultAway && normPredAway === normResultHome;
        });
    }
    
    findSimilarMatch(predHome, predAway, results) {
        for (const result of results) {
            const homeSimilarity = this.calculateSimilarity(predHome, result.homeTeam);
            const awaySimilarity = this.calculateSimilarity(predAway, result.awayTeam);
            
            if (homeSimilarity >= 0.7 && awaySimilarity >= 0.7) {
                logger.info(`🔍 Match similaire: ${predHome}≈${result.homeTeam}, ${predAway}≈${result.awayTeam}`);
                return result;
            }
        }
        
        return null;
    }
    
    normalizeTeamName(name) {
        if (!name) return '';
        
        // Appliquer le mapping
        const mappedName = this.TEAM_MAPPING[name] || name;
        
        // Normalisation
        return mappedName
            .toLowerCase()
            .replace(/\./g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }
    
    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        const s1 = this.normalizeForSimilarity(str1);
        const s2 = this.normalizeForSimilarity(str2);
        
        if (s1 === s2) return 1;
        if (s1.includes(s2) || s2.includes(s1)) return 0.9;
        
        // Similarité simple
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        
        if (longer.length === 0) return 1.0;
        
        // Calcul simple de similarité
        let matches = 0;
        for (let i = 0; i < Math.min(shorter.length, 3); i++) {
            if (longer.includes(shorter[i])) matches++;
        }
        
        return matches / Math.min(shorter.length, 3);
    }
    
    normalizeForSimilarity(str) {
        return str
            .toLowerCase()
            .replace(/[^a-z]/g, '')
            .trim();
    }
    
    async analyzePerformance() {
        try {
            const predictions = JSON.parse(fs.readFileSync(this.predictionsPath, 'utf8'));
            const completed = predictions.filter(p => p.actual_result !== null);
            
            if (completed.length === 0) {
                logger.info('📊 Aucun match complété pour analyse');
                return;
            }
            
            const correct = completed.filter(p => p.is_correct === true).length;
            const accuracy = (correct / completed.length * 100).toFixed(1);
            
            // Stats par type de prédiction
            const byPrediction = {};
            completed.forEach(p => {
                const type = p.prediction;
                byPrediction[type] = byPrediction[type] || { total: 0, correct: 0 };
                byPrediction[type].total++;
                if (p.is_correct) byPrediction[type].correct++;
            });
            
            // Calculer les pourcentages
            Object.keys(byPrediction).forEach(type => {
                const data = byPrediction[type];
                data.accuracy = data.total > 0 ? (data.correct / data.total * 100).toFixed(1) : 0;
            });
            
            // Sauvegarder
            let history = [];
            if (fs.existsSync(this.performancePath)) {
                const content = fs.readFileSync(this.performancePath, 'utf8');
                if (content.trim()) {
                    history = JSON.parse(content);
                }
            }
            
            history.push({
                timestamp: new Date().toISOString(),
                total: completed.length,
                correct: correct,
                accuracy: accuracy,
                by_prediction: byPrediction
            });
            
            // Garder 100 entrées max
            if (history.length > 100) history = history.slice(-100);
            
            fs.writeFileSync(this.performancePath, JSON.stringify(history, null, 2));
            
            logger.info(`📈 Performance: ${accuracy}% sur ${completed.length} matchs`);
            Object.entries(byPrediction).forEach(([type, data]) => {
                logger.info(`   ${type}: ${data.accuracy}% (${data.correct}/${data.total})`);
            });
            
        } catch (error) {
            logger.error(`❌ Erreur analyse performance: ${error.message}`);
        }
    }
    
    detectPatterns() {
        try {
            const predictions = JSON.parse(fs.readFileSync(this.predictionsPath, 'utf8'));
            const completed = predictions.filter(p => p.actual_result !== null);
            
            if (completed.length < 3) return;
            
            const patterns = {
                team_patterns: {},
                last_updated: new Date().toISOString()
            };
            
            // Patterns simples
            completed.forEach(p => {
                const [home, away] = p.match.split(' vs ');
                
                // Patterns domicile
                const homeKey = `home_${home}`;
                patterns.team_patterns[homeKey] = patterns.team_patterns[homeKey] || { total: 0, wins: 0 };
                patterns.team_patterns[homeKey].total++;
                if (p.actual_result === '1') patterns.team_patterns[homeKey].wins++;
                
                // Patterns extérieur
                const awayKey = `away_${away}`;
                patterns.team_patterns[awayKey] = patterns.team_patterns[awayKey] || { total: 0, wins: 0 };
                patterns.team_patterns[awayKey].total++;
                if (p.actual_result === '2') patterns.team_patterns[awayKey].wins++;
            });
            
            // Calculer les taux
            Object.keys(patterns.team_patterns).forEach(key => {
                const pattern = patterns.team_patterns[key];
                if (pattern.total >= 3) {
                    pattern.win_rate = (pattern.wins / pattern.total * 100).toFixed(1);
                    pattern.significant = pattern.win_rate >= 70 || pattern.win_rate <= 30;
                }
            });
            
            // Filtrer
            patterns.team_patterns = Object.fromEntries(
                Object.entries(patterns.team_patterns).filter(([_, p]) => 
                    p.total >= 3 && p.significant
                )
            );
            
            fs.writeFileSync(this.patternsPath, JSON.stringify(patterns, null, 2));
            
            const significantCount = Object.keys(patterns.team_patterns).length;
            if (significantCount > 0) {
                logger.info(`🎯 ${significantCount} patterns détectés`);
            }
            
        } catch (error) {
            logger.error(`❌ Erreur détection patterns: ${error.message}`);
        }
    }
    
    start(intervalMinutes = 2) {
        logger.info(`⏰ Analyse automatique programmée toutes les ${intervalMinutes} minutes`);
        
        // Premier run après 10s
        setTimeout(() => {
            this.run();
        }, 10000);
        
        // Puis toutes les X minutes
        setInterval(() => {
            this.run();
        }, intervalMinutes * 60 * 1000);
    }
    
    async forceRun() {
        logger.info('🚀 Analyse forcée démarrée');
        return await this.run();
    }
}

module.exports = new AutoAnalyzer();