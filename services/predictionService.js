const axios = require('axios');
const logger = require('../middlewares/logger');

const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10)",
  "App-Version": "27869",
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/"
};

async function fetchData() {
  const urls = {
    results: "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/results?skip=0&take=100",
    matches: "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/matches",
    ranking: "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/ranking"
  };

  const data = {};
  for (const [key, url] of Object.entries(urls)) {
    try {
      const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });
      data[key] = response.data;
      logger.info(`API ${key} réussie`);
    } catch (error) {
      logger.error(`Erreur API ${key}: ${error.message}`);
      data[key] = null;
    }
  }
  return data;
}

function findNextMatches(data) {
  if (data && data.matches && data.matches.rounds) {
    const rounds = data.matches.rounds;
    for (const round of rounds) {
      if (round.matches && round.matches.length > 0) {
        return round.matches;
      }
    }
  }
  return [];
}

function calculateTeamForm(teamName, data) {
  const formMap = { 'Won': 1, 'Draw': 0.5, 'Lost': 0 };
  let formScores = [];
  
  try {
    if (data.results && data.results.rounds) {
      for (const round of data.results.rounds) {
        for (const match of round.matches) {
          const homeTeam = match.homeTeam.name;
          const awayTeam = match.awayTeam.name;
          
          if (teamName === homeTeam || teamName === awayTeam) {
            if (match.goals && match.goals.length > 0) {
              const lastGoal = match.goals[match.goals.length - 1];
              const homeScore = lastGoal.homeScore;
              const awayScore = lastGoal.awayScore;
              
              let result;
              if (teamName === homeTeam) {
                result = homeScore > awayScore ? 'Won' : 
                         homeScore === awayScore ? 'Draw' : 'Lost';
              } else {
                result = awayScore > homeScore ? 'Won' : 
                         homeScore === awayScore ? 'Draw' : 'Lost';
              }
              formScores.push(formMap[result]);
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error("Erreur dans le calcul historique de forme: " + error.message);
  }

  if (formScores.length === 0 && data.ranking && data.ranking.teams) {
    try {
      const team = data.ranking.teams.find(t => t.name === teamName);
      if (team && team.history) {
        for (const result of team.history.slice(-5)) {
          formScores.push(formMap[result] || 0);
        }
      }
    } catch (error) {
      logger.error("Erreur dans le calcul de forme via classement: " + error.message);
    }
  }

  if (formScores.length > 0) {
    const avg = formScores.slice(-5).reduce((a, b) => a + b, 0) / formScores.slice(-5).length;
    return Math.round(avg * 100) / 100;
  }
  return 0.5;
}

function extractOdds(match) {
  const oddsData = {
    '1x2': { home: null, draw: null, away: null },
    ht_1x2: { home: null, draw: null, away: null },
    exact_score: {}
  };
  
  if (!match.eventBetTypes) return oddsData;
  
  for (const betType of match.eventBetTypes) {
    const betName = betType.name || '';
    const items = betType.eventBetTypeItems || [];
    
    if (betName === '1X2') {
      for (const item of items) {
        const shortName = item.shortName || '';
        const odds = item.odds || 0.0;
        
        if (shortName === '1') oddsData['1x2'].home = odds;
        else if (shortName === 'X') oddsData['1x2'].draw = odds;
        else if (shortName === '2') oddsData['1x2'].away = odds;
      }
    }
    else if (betName === 'Mi-tps 1X2') {
      for (const item of items) {
        const shortName = item.shortName || '';
        const odds = item.odds || 0.0;
        
        if (shortName === '1') oddsData.ht_1x2.home = odds;
        else if (shortName === 'X') oddsData.ht_1x2.draw = odds;
        else if (shortName === '2') oddsData.ht_1x2.away = odds;
      }
    }
    else if (betName === 'Score exact') {
      for (const item of items) {
        const shortName = item.shortName || '';
        const odds = item.odds || 0.0;
        oddsData.exact_score[shortName] = odds;
      }
    }
  }
  
  return oddsData;
}

function predictGoals(exactScores) {
  if (!exactScores || Object.keys(exactScores).length === 0) {
    return null;
  }
  
  const goalsProbs = {};
  let totalProb = 0;
  
  for (const [score, odds] of Object.entries(exactScores)) {
    try {
      if (odds <= 1) continue;
      
      if (score.includes('-')) {
        const [homeGoals, awayGoals] = score.split('-').map(Number);
        const totalGoals = homeGoals + awayGoals;
        
        const prob = 1 / odds;
        goalsProbs[totalGoals] = (goalsProbs[totalGoals] || 0) + prob;
        totalProb += prob;
      }
    } catch (error) {
      continue;
    }
  }
  
  if (totalProb === 0 || Object.keys(goalsProbs).length === 0) {
    return null;
  }
  
  // Normalize probabilities
  for (const goals in goalsProbs) {
    goalsProbs[goals] /= totalProb;
  }
  
  // Find most probable total goals
  let predictedGoals = 2;
  let maxConfidence = 0;
  
  for (const [goals, prob] of Object.entries(goalsProbs)) {
    if (prob > maxConfidence) {
      predictedGoals = parseInt(goals);
      maxConfidence = prob;
    }
  }
  
  logger.info(`Prédiction par 'Score exact': ${predictedGoals} buts (confiance: ${(maxConfidence * 100).toFixed(2)}%)`);
  return predictedGoals;
}

function predictResultFromOdds(oddsDict) {
  if (!oddsDict.home || !oddsDict.draw || !oddsDict.away) {
    return [null, null];
  }
  
  try {
    const probs = {
      home: 1 / oddsDict.home,
      draw: 1 / oddsDict.draw,
      away: 1 / oddsDict.away
    };
    
    const total = probs.home + probs.draw + probs.away;
    probs.home /= total;
    probs.draw /= total;
    probs.away /= total;
    
    let predictedResult = 'draw';
    let confidence = probs.draw;
    
    if (probs.home > confidence) {
      predictedResult = 'home';
      confidence = probs.home;
    }
    if (probs.away > confidence) {
      predictedResult = 'away';
      confidence = probs.away;
    }
    
    const resultMap = { 'home': '1', 'draw': 'X', 'away': '2' };
    return [resultMap[predictedResult], confidence];
  } catch (error) {
    return [null, null];
  }
}

async function predictMatch(match, data) {
  const homeTeam = match.homeTeam.name;
  const awayTeam = match.awayTeam.name;
  
  const oddsData = extractOdds(match);
  
  const [finalResult] = predictResultFromOdds(oddsData['1x2']);
  const [htResult] = predictResultFromOdds(oddsData.ht_1x2);
  const goals = predictGoals(oddsData.exact_score);
  
  // Calculate team forms
  const homeForm = calculateTeamForm(homeTeam, data);
  const awayForm = calculateTeamForm(awayTeam, data);
  
  return {
    match: `${homeTeam} vs ${awayTeam}`,
    final_result: finalResult || 'X',
    goals: goals || 2,
    half_time: htResult || 'X',
    odds_1x2: `${oddsData['1x2'].home || '-'}/${oddsData['1x2'].draw || '-'}/${oddsData['1x2'].away || '-'}`,
    odds_ht: `${oddsData.ht_1x2.home || '-'}/${oddsData.ht_1x2.draw || '-'}/${oddsData.ht_1x2.away || '-'}`,
    home_form: homeForm,
    away_form: awayForm
  };
}

module.exports = {
  getPredictions: async () => {
    try {
      const data = await fetchData();
      const nextMatches = findNextMatches(data);
      
      const predictions = [];
      for (const match of nextMatches) {
        predictions.push(await predictMatch(match, data));
      }
      
      return predictions;
    } catch (error) {
      logger.error('Erreur de prédiction: ' + error.message);
      return [];
    }
  }
};