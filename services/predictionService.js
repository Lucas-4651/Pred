'use strict';

const axios      = require('axios');
const logger     = require('../middlewares/logger');
const NodeCache  = require('node-cache');
const sequelize  = require('../config/database');
const { DataTypes, Op } = require('sequelize');
const Prediction   = require('../models/Prediction')(sequelize, DataTypes);
const Rating       = require('../models/Rating')(sequelize, DataTypes);
const LearningState = require('../models/LearningState')(sequelize, DataTypes);
const CircuitBreaker = require('opossum');
const promClient   = require('prom-client');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const config = {
  api: {
    timeout: 6000,
    circuitBreaker: {
      timeout: 6000,
      errorThresholdPercentage: 70,
      resetTimeout: 30000,
      volumeThreshold: 5
    }
  },
  cache: {
    api:         60,
    h2h:         14400,
    learning:    10000,
    patterns:    7200,
    intermediate:300
  },
  learning: {
    adjustmentInterval:            100,
    saveInterval:                   50,
    minPredictionsForAdjustment:   150,
    performanceWindow:              80,
    vflSpecific: {
      cycleDetection: true,
      patternWeight:  0.15,
      biasAdjustment: true
    }
  },
  db: {
    batchSize: 300,
    saveDelay: 3000
  },
  vfl: {
    homeWinRateTarget:          0.44,
    drawRateTarget:             0.26,
    awayWinRateTarget:          0.30,
    avgGoalsTarget:             2.5,
    adaptationRate:             0.1,
    homeAdvantageMin:           0.15,
    homeAdvantageMax:           0.28,
    confidenceBoostThreshold:   12,
    confidencePenaltyThreshold: 25
  },
  scorePrediction: {
    maxGoals:           6,
    calibrationWindow: 100,
    goalCategories: [
      { max: 2.0, reduction: 0.90, label: 'veryLow'  },
      { max: 2.8, reduction: 0.85, label: 'low'       },
      { max: 3.5, reduction: 0.80, label: 'medium'    },
      { max: 4.2, reduction: 0.75, label: 'high'      },
      { max: 5.0, reduction: 0.70, label: 'veryHigh'  },
      { max: 99,  reduction: 0.65, label: 'extreme'   }
    ],
    formBoostThreshold: 65,
    formDiffThreshold:  25,
    attackThreshold:    1.2,
    ensembleWeights: { poisson: 0.4, historical: 0.3, form: 0.2, pattern: 0.1 }
  }
};

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const CONSTANTS = {
  MIN_CONFIDENCE:      30,
  MAX_CONFIDENCE:      95,
  DEFAULT_ELO:         1600,
  MAX_GOALS_PREDICTION: 6,
  MIN_GOALS_PREDICTION: 0
};

const FALLBACK_PREDICTION = {
  home: 0.33, draw: 0.34, away: 0.33,
  expectedGoals: 2.5, mostLikelyScore: '1:1',
  homeRating: 1600, awayRating: 1600,
  scoreMatrix: []
};

// ─── UTILS MATHÉMATIQUES PARTAGÉS ────────────────────────────────────────────
function safeNum(val, def = 0) {
  return (typeof val === 'number' && isFinite(val)) ? val : def;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonProb(lambda, k) {
  if (k > 6 || lambda <= 0) return 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function normalizeTrio(obj) {
  const sum = (obj.home || 0) + (obj.draw || 0) + (obj.away || 0);
  if (sum <= 0) return { home: 0.33, draw: 0.34, away: 0.33 };
  return { home: obj.home / sum, draw: obj.draw / sum, away: obj.away / sum };
}

// ─── MONITORING ───────────────────────────────────────────────────────────────
const metrics = {
  predictionsTotal: new promClient.Counter({
    name: 'predictions_total', help: 'Total des prédictions effectuées',
    labelNames: ['result']
  }),
  accuracyGauge: new promClient.Gauge({
    name: 'prediction_accuracy', help: 'Précision globale du modèle'
  }),
  apiErrors: new promClient.Counter({
    name: 'api_errors_total', help: 'Total des erreurs API',
    labelNames: ['endpoint']
  }),
  predictionLatency: new promClient.Histogram({
    name: 'prediction_latency_seconds', help: 'Latence des prédictions',
    buckets: [0.1, 0.5, 1, 2, 5]
  }),
  cacheHits: new promClient.Counter({
    name: 'cache_hits_total', help: 'Total des hits cache',
    labelNames: ['cache']
  }),
  vflBiasGauge: new promClient.Gauge({
    name: 'vfl_bias_detected', help: 'Biais détecté dans le jeu virtuel',
    labelNames: ['type']
  }),
  goalAccuracy: new promClient.Gauge({
    name: 'goal_accuracy', help: 'Précision des prédictions de buts',
    labelNames: ['type']
  }),
  scoreCalibration: new promClient.Gauge({
    name: 'score_calibration', help: 'Calibration des prédictions de score',
    labelNames: ['confidence_level']
  }),
  scoreDistribution: new promClient.Gauge({
    name: 'score_distribution', help: 'Distribution des scores prédits',
    labelNames: ['score']
  })
};

function safeMetric(fn) {
  try { fn(); } catch (e) { logger.debug('Metric error (non-bloquant)', e.message); }
}

// ─── CACHES ───────────────────────────────────────────────────────────────────
const caches = {
  api:         new NodeCache({ stdTTL: config.cache.api,          checkperiod: 120, useClones: false, maxKeys: 100 }),
  h2h:         new NodeCache({ stdTTL: config.cache.h2h,          useClones: false, maxKeys: 500 }),
  learning:    new NodeCache({ stdTTL: config.cache.learning,     useClones: false, maxKeys: 200  }),
  patterns:    new NodeCache({ stdTTL: config.cache.patterns,     useClones: false, maxKeys: 150 }),
  intermediate:new NodeCache({ stdTTL: config.cache.intermediate, useClones: false, maxKeys: 250 })
};

const MAX_MEM_CACHE = 1000;
const memoryCaches = { h2h: new Map(), intermediate: new Map() };

function cleanMemCacheIfNeeded(cache) {
  if (cache.size > MAX_MEM_CACHE) {
    const keys = Array.from(cache.keys()).slice(0, 200);
    keys.forEach(k => cache.delete(k));
  }
}

function getCached(key, cacheName, fn, ttlMs = 300_000) {
  const mem = memoryCaches[cacheName];
  if (!mem) return fn();

  cleanMemCacheIfNeeded(mem);

  const hit = mem.get(key);
  if (hit && (Date.now() - hit.ts) < ttlMs) {
    safeMetric(() => metrics.cacheHits.labels(`${cacheName}_memory`).inc());
    return hit.val;
  }

  const val = fn();
  mem.set(key, { val, ts: Date.now() });
  return val;
}

setInterval(() => {
  Object.values(memoryCaches).forEach(c => c.clear());
  logger.info('Caches mémoire nettoyés');
}, 3_600_000);

// ─── CIRCUIT BREAKER ─────────────────────────────────────────────────────────
const HEADERS = {
  'Accept':          'application/json, text/plain, */*',
  'User-Agent':      'Mozilla/5.0 (Linux; Android 10)',
  'App-Version':     '27869',
  'Origin':          'https://bet261.mg',
  'Referer':         'https://bet261.mg/',
  'Accept-Encoding': 'gzip, deflate'
};

const breakers = new Map();

function getBreaker(url) {
  if (!breakers.has(url)) {
    const breaker = new CircuitBreaker(
      async () => {
        const res = await axios.get(url, {
          headers: HEADERS,
          timeout: config.api.timeout,
          decompress: true
        });
        return res.data;
      },
      {
        ...config.api.circuitBreaker,
        errorFilter: (err) => err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT'
      }
    );
    breaker.fallback(() => null);
    breakers.set(url, breaker);
  }
  return breakers.get(url);
}

// ─── LAZY SYSTEM ────────────────────────────────────────────────────────────
class LazySystem {
  constructor(loader) {
    this.loader   = loader;
    this.instance = null;
    this._promise = null;
  }

  async get() {
    if (this.instance) return this.instance;

    if (!this._promise) {
      this._promise = (async () => {
        try {
          this.instance = await this.loader();
          return this.instance;
        } catch (err) {
          this._promise = null;
          throw err;
        }
      })();
    }

    return this._promise;
  }
}

// ─── SEUILS ADAPTATIFS ────────────────────────────────────────────────────────
class AdaptiveThresholds {
  constructor() {
    this.thresholds = { confidence: 65, homeAdvantage: 0.18, drawProbability: 0.27 };
    this.performance = [];
  }

  update(prediction, actual) {
    this.performance.push({
      correct: prediction.prediction === actual,
      confidence: prediction.confidence,
      homeWin: actual === '1',
      draw: actual === 'X'
    });
    if (this.performance.length > 100) {
      this.performance.shift();
      this._recalibrate();
    }
  }

  _recalibrate() {
    const recent = this.performance.slice(-50);
    if (recent.length < 30) return;

    let bestT = 50, bestAcc = 0;
    for (let t = 50; t <= 80; t += 5) {
      const acc = recent.filter(p => (p.confidence >= t) === p.correct).length / recent.length;
      if (acc > bestAcc) { bestAcc = acc; bestT = t; }
    }
    this.thresholds.confidence = bestT;
  }

  get() { return this.thresholds; }
}

// ─── CORRECTEUR DE BIAIS ─────────────────────────────────────────────────────
class BiasCorrector {
  constructor() {
    this.stats = {
      homeWin: { predicted: 0, actual: 0 },
      draw:    { predicted: 0, actual: 0 },
      awayWin: { predicted: 0, actual: 0 },
      count:   0
    };
    this.correction = null;
  }

  update(prediction, actual) {
    if (!prediction || !actual) return;

    const predKey = prediction === '1' ? 'homeWin' : prediction === 'X' ? 'draw' : 'awayWin';
    const actKey  = actual    === '1' ? 'homeWin' : actual    === 'X' ? 'draw' : 'awayWin';

    this.stats[predKey].predicted++;
    this.stats[actKey].actual++;
    this.stats.count++;

    if (this.stats.count === 50 || this.stats.count % 100 === 0) {
      this._calculateCorrection();
    }

    safeMetric(() => {
      const n = this.stats.count || 1;
      metrics.vflBiasGauge.labels('home_win').set(this.stats.homeWin.actual / n);
      metrics.vflBiasGauge.labels('draw').set(this.stats.draw.actual / n);
    });
  }

  _calculateCorrection() {
    if (this.stats.count < 50) return;
    const n = this.stats.count;

    this.correction = {
      home: (this.stats.homeWin.actual / n) / ((this.stats.homeWin.predicted / n) || 0.44),
      draw: (this.stats.draw.actual    / n) / ((this.stats.draw.predicted    / n) || 0.26),
      away: (this.stats.awayWin.actual / n) / ((this.stats.awayWin.predicted / n) || 0.30)
    };

    this.correction = normalizeTrio(this.correction);
  }

  correct(probabilities) {
    if (!this.correction || !probabilities) return probabilities;
    return normalizeTrio({
      home: probabilities.home * this.correction.home,
      draw: probabilities.draw * this.correction.draw,
      away: probabilities.away * this.correction.away
    });
  }

  getStats() {
    const n = this.stats.count || 1;
    return {
      homeWinRate: this.stats.homeWin.actual / n,
      drawRate:    this.stats.draw.actual    / n,
      awayWinRate: this.stats.awayWin.actual / n,
      sampleSize:  this.stats.count,
      correction:  this.correction
    };
  }
}

// ─── ANALYSEUR DE DISTRIBUTION DES SCORES ────────────────────────────────────
class ScoreDistributionAnalyzer {
  constructor() {
    this.scoreStats   = new Map();
    this.totalMatches = 0;
    this.commonScores = [];
    this.goalRanges   = { low: 0, medium: 0, high: 0 };
  }

  updateFromMatch(homeGoals, awayGoals) {
    const score = `${homeGoals}-${awayGoals}`;
    this.scoreStats.set(score, (this.scoreStats.get(score) || 0) + 1);
    this.totalMatches++;

    const total = homeGoals + awayGoals;
    if      (total <= 1) this.goalRanges.low++;
    else if (total <= 3) this.goalRanges.medium++;
    else                 this.goalRanges.high++;

    if (this.totalMatches % 10 === 0) this._updateCommonScores();

    safeMetric(() =>
      metrics.scoreDistribution.labels(score).set(this._scoreFrequency(score))
    );
  }

  _updateCommonScores() {
    this.commonScores = Array.from(this.scoreStats.entries())
      .map(([score, count]) => ({ score, frequency: count / this.totalMatches, count }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
  }

  getMostLikelyScores(limit = 5) { return this.commonScores.slice(0, limit); }

  _scoreFrequency(score) {
    return (this.scoreStats.get(score) || 0) / (this.totalMatches || 1);
  }

  getAverageGoals() {
    if (!this.totalMatches) return 2.5;
    let total = 0;
    for (const [score, count] of this.scoreStats) {
      const [h, a] = score.split('-').map(Number);
      total += (h + a) * count;
    }
    return total / this.totalMatches;
  }

  getGoalRangeDistribution() {
    const n = this.totalMatches || 1;
    return {
      low:    this.goalRanges.low    / n,
      medium: this.goalRanges.medium / n,
      high:   this.goalRanges.high   / n
    };
  }
}

// ─── SYSTÈME D'APPRENTISSAGE DES BUTS ─────────────────────────────────────────
class GoalLearningSystem {
  constructor() {
    this.goalHistory    = [];
    this.teamAverages   = new Map();
    this.contextFactors = new Map();
    this.rangeCalibration = {
      low:    { count: 0 },
      medium: { count: 0 },
      high:   { count: 0 }
    };
  }

  recordMatch(homeTeam, awayTeam, homeGoals, awayGoals, context) {
    const total = homeGoals + awayGoals;

    this.goalHistory.push({ total, ts: Date.now() });
    if (this.goalHistory.length > 200) this.goalHistory.shift();

    for (const [team, scored, conceded] of [
      [homeTeam, homeGoals, awayGoals],
      [awayTeam, awayGoals, homeGoals]
    ]) {
      const s = this.teamAverages.get(team) ||
        { scored: 0, conceded: 0, matches: 0, total: 0, history: [] };

      s.history.push({ scored, conceded, total });
      if (s.history.length > 30) s.history.shift();

      let sumW = 0, sumScored = 0, sumConceded = 0, sumTotal = 0;
      s.history.forEach((h, i) => {
        const age = s.history.length - 1 - i;
        const w   = Math.exp(-0.10 * age);
        sumW        += w;
        sumScored   += w * h.scored;
        sumConceded += w * h.conceded;
        sumTotal    += w * h.total;
      });

      s.scored   = sumW > 0 ? sumScored   / sumW : scored;
      s.conceded = sumW > 0 ? sumConceded / sumW : conceded;
      s.total    = sumW > 0 ? sumTotal    / sumW : total;
      s.matches  = s.history.length;
      this.teamAverages.set(team, s);
    }

    const ctxKey = this._contextKey(context);
    const ctx    = this.contextFactors.get(ctxKey) || { goals: 0, matches: 0 };
    ctx.goals   += total;
    ctx.matches++;
    this.contextFactors.set(ctxKey, ctx);

    const range = total <= 2 ? 'low' : total <= 4 ? 'medium' : 'high';
    this.rangeCalibration[range].count++;
  }

  _teamAvg(team, type = 'total') {
    const s = this.teamAverages.get(team);
    if (!s || s.matches < 3) return null;
    if (type === 'scored')   return s.scored   / s.matches;
    if (type === 'conceded') return s.conceded / s.matches;
    return s.total / s.matches;
  }

  _contextKey(ctx = {}) {
    if (ctx.bigMatch) return 'bigMatch';
    if (ctx.derby)    return 'derby';
    if (ctx.revenge)  return 'revenge';
    if (ctx.streak)   return 'streak';
    if (ctx.mismatch) return 'mismatch';
    return 'normal';
  }

  predictGoals(rawExpected, homeTeam, awayTeam, context) {
    let predicted = rawExpected;

    const homeAvg = this._teamAvg(homeTeam);
    const awayAvg = this._teamAvg(awayTeam);
    if (homeAvg !== null && awayAvg !== null) {
      predicted = predicted * 0.7 + ((homeAvg + awayAvg) / 2) * 0.3;
    }

    const ctxKey  = this._contextKey(context);
    const ctxData = this.contextFactors.get(ctxKey);
    if (ctxData && ctxData.matches >= 5 && this.goalHistory.length > 0) {
      const globalAvg = this.goalHistory.reduce((a, b) => a + b, 0) / this.goalHistory.length;
      predicted *= (ctxData.goals / ctxData.matches) / (globalAvg || 2.5);
    }

    return predicted;
  }
}

// ─── CALIBREUR DE SCORES ──────────────────────────────────────────────────────
class ScoreCalibrator {
  constructor() {
    this.predictionErrors        = [];
    this.goalBias                = 0;
    this.contextCalibration      = new Map();
    this.rangeCalibration        = new Map();
    this.calibrationByConfidence = new Map();
  }

  recordPrediction(predictedScore, actualScore, confidence) {
    const [pH, pA] = predictedScore.split(':').map(Number);
    const [aH, aA] = actualScore.split(':').map(Number);

    this.predictionErrors.push((pH - aH) + (pA - aA));
    if (this.predictionErrors.length > config.scorePrediction.calibrationWindow) {
      this.predictionErrors.shift();
    }
    this._recalibrate();

    const lvl = Math.floor(confidence / 10) * 10;
    const d   = this.calibrationByConfidence.get(lvl) || { correct: 0, total: 0, exact: 0 };
    d.total++;
    if (pH === aH && pA === aA) d.exact++;
    const pW = pH > pA ? 'H' : pH < pA ? 'A' : 'D';
    const aW = aH > aA ? 'H' : aH < aA ? 'A' : 'D';
    if (pW === aW) d.correct++;
    this.calibrationByConfidence.set(lvl, d);

    safeMetric(() =>
      metrics.scoreCalibration.labels(`${lvl}%`).set(d.exact / d.total)
    );
  }

  recordGoalPrediction(predictedGoals, actualGoals, context = {}) {
    const error  = predictedGoals - actualGoals;
    const ctxKey = this._contextKey(context);

    let c = this.contextCalibration.get(ctxKey) || { errors: [], count: 0 };
    c.errors.push(error);
    c.count++;
    if (c.errors.length > 50) c.errors.shift();
    this.contextCalibration.set(ctxKey, c);

    const range = actualGoals <= 2 ? 'low' : actualGoals <= 4 ? 'medium' : 'high';
    let r = this.rangeCalibration.get(range) || { errors: [], count: 0 };
    r.errors.push(error);
    r.count++;
    this.rangeCalibration.set(range, r);
  }

  _contextKey(ctx = {}) {
    if (ctx.bigMatch) return 'bigMatch';
    if (ctx.derby)    return 'derby';
    if (ctx.revenge)  return 'revenge';
    if (ctx.streak)   return 'streak';
    if (ctx.mismatch) return 'mismatch';
    return 'normal';
  }

  getContextualBias(context) {
    const d = this.contextCalibration.get(this._contextKey(context));
    if (!d || d.count < 10) return 0;
    return d.errors.reduce((a, b) => a + b, 0) / d.errors.length;
  }

  _recalibrate() {
    if (this.predictionErrors.length < 20) return;
    const avg = this.predictionErrors.reduce((a, b) => a + b, 0) / this.predictionErrors.length;
    this.goalBias = this.goalBias * 0.5 + avg * 0.5;
  }

  adjustPrediction(rawGoals) {
    return clamp(Math.round(rawGoals - this.goalBias),
      CONSTANTS.MIN_GOALS_PREDICTION, CONSTANTS.MAX_GOALS_PREDICTION);
  }

  calibrateScoreProbability(scoreProbs, confidence) {
    const lvl  = Math.floor(confidence / 10) * 10;
    const data = this.calibrationByConfidence.get(lvl);
    if (!data || data.total < 20) return scoreProbs;

    const factor = (data.exact / data.total) / (confidence / 100);
    return scoreProbs.map(sp => ({ ...sp, probability: sp.probability * factor }));
  }

  getBias() { return this.goalBias; }

  getCalibrationStats() {
    const stats = {};
    this.calibrationByConfidence.forEach((d, lvl) => {
      stats[lvl] = {
        accuracy:   d.correct / d.total,
        exactRate:  d.exact   / d.total,
        sampleSize: d.total
      };
    });
    return stats;
  }
}

// ─── TRACKER DE MÉTRIQUES DE SCORES ──────────────────────────────────────────
class ScoreMetricsTracker {
  constructor() {
    this._m = {
      exactMatch:    { correct: 0, total: 0 },
      withinOneGoal: { correct: 0, total: 0 },
      correctWinner: { correct: 0, total: 0 },
      goalDifference:{ correct: 0, total: 0 },
      totalGoals:    { correct: 0, total: 0 },
      goalRange:     { correct: 0, total: 0 },
      goalsExact:    { correct: 0, total: 0 },
      goalsWithin1:  { correct: 0, total: 0 }
    };
    this.byScoreType      = new Map();
    this.byConfidence     = new Map();
    this.recentPerformance = [];
    this._goalBiasSum     = 0;
  }

  record(predictedScore, actualScore, confidence, predictedGoals, actualGoals) {
    const [pH, pA] = predictedScore.split(':').map(Number);
    const [aH, aA] = actualScore.split(':').map(Number);
    const pTotal = pH + pA, aTotal = aH + aA;
    const pW = pH > pA ? 'H' : pH < pA ? 'A' : 'D';
    const aW = aH > aA ? 'H' : aH < aA ? 'A' : 'D';
    const exact = pH === aH && pA === aA;

    for (const key of Object.keys(this._m)) this._m[key].total++;

    if (exact)                                       this._m.exactMatch.correct++;
    if (Math.abs(pH - aH) <= 1 && Math.abs(pA - aA) <= 1) this._m.withinOneGoal.correct++;
    if (pW === aW)                                   this._m.correctWinner.correct++;
    if (Math.abs(pH - pA) === Math.abs(aH - aA))    this._m.goalDifference.correct++;
    if (pTotal === aTotal)                           this._m.totalGoals.correct++;
    if (this._goalRange(pTotal) === this._goalRange(aTotal)) this._m.goalRange.correct++;
    if (predictedGoals === actualGoals)              this._m.goalsExact.correct++;
    if (Math.abs(predictedGoals - actualGoals) <= 1) this._m.goalsWithin1.correct++;

    this._goalBiasSum += (predictedGoals - actualGoals);

    const type = this._categorizeScore(predictedScore);
    const ts   = this.byScoreType.get(type) || { correct: 0, total: 0 };
    ts.total++;
    if (exact) ts.correct++;
    this.byScoreType.set(type, ts);

    const lvl = Math.floor(confidence / 10) * 10;
    const cs  = this.byConfidence.get(lvl) || { correct: 0, total: 0, exact: 0, goalsExact: 0 };
    cs.total++;
    if (pW === aW)              cs.correct++;
    if (exact)                  cs.exact++;
    if (predictedGoals === actualGoals) cs.goalsExact++;
    this.byConfidence.set(lvl, cs);

    this.recentPerformance.push({ exact, goalsExact: predictedGoals === actualGoals, confidence });
    if (this.recentPerformance.length > 100) this.recentPerformance.shift();

    safeMetric(() => {
      metrics.goalAccuracy.labels('exact').set(this._rate('goalsExact'));
      metrics.goalAccuracy.labels('within1').set(this._rate('goalsWithin1'));
      metrics.goalAccuracy.labels('bias').set(
        this._m.goalsExact.total > 0 ? this._goalBiasSum / this._m.goalsExact.total : 0
      );
    });
  }

  _rate(key) {
    const d = this._m[key];
    return d.total > 0 ? d.correct / d.total : 0;
  }

  _goalRange(g) {
    if (g <= 1) return 'low';
    if (g <= 3) return 'medium';
    return 'high';
  }

  _categorizeScore(score) {
    const [h, a] = score.split(':').map(Number);
    if (h === a) return h === 0 ? '0-0' : h === 1 ? '1-1' : 'draw_high';
    if (h > a)   return (h - a === 1) ? 'home_narrow' : 'home_wide';
    return (a - h === 1) ? 'away_narrow' : 'away_wide';
  }

  getExactAccuracy()         { return this._rate('exactMatch');    }
  getWinnerAccuracy()        { return this._rate('correctWinner'); }
  getWithinOneAccuracy()     { return this._rate('withinOneGoal'); }
  getGoalsExactAccuracy()    { return this._rate('goalsExact');    }
  getGoalsWithinOneAccuracy(){ return this._rate('goalsWithin1'); }

  getDetailedMetrics() {
    const byScoreType = {};
    this.byScoreType.forEach((s, t) => { byScoreType[t] = { accuracy: s.correct / s.total, count: s.total }; });

    const byConfidence = {};
    this.byConfidence.forEach((s, lvl) => {
      byConfidence[lvl] = {
        winnerAccuracy:    s.correct   / s.total,
        exactAccuracy:     s.exact     / s.total,
        goalsExactAccuracy:s.goalsExact/ s.total,
        count: s.total
      };
    });

    const recent = this.recentPerformance.slice(-50);
    return {
      overall: {
        exactMatch:     this._rate('exactMatch'),
        withinOneGoal:  this._rate('withinOneGoal'),
        correctWinner:  this._rate('correctWinner'),
        goalDifference: this._rate('goalDifference'),
        totalGoals:     this._rate('totalGoals'),
        goalRange:      this._rate('goalRange'),
        goalsExact:     this._rate('goalsExact'),
        goalsWithin1:   this._rate('goalsWithin1'),
        goalsBias:      this._m.goalsExact.total > 0 ? this._goalBiasSum / this._m.goalsExact.total : 0,
        totalPredictions: this._m.exactMatch.total
      },
      byScoreType,
      byConfidence,
      recentAccuracy:      recent.filter(r => r.exact).length      / (recent.length || 1),
      recentGoalsAccuracy: recent.filter(r => r.goalsExact).length / (recent.length || 1),
      sampleSize: this._m.exactMatch.total
    };
  }
}

// ─── PRÉDICTEUR DE SCORE AVANCÉ ───────────────────────────────────────────────
class AdvancedScorePredictor {
  constructor() {
    this.teamProfiles  = new Map();
    this.scorePatterns = new Map();
  }

  predictExactScore(poissonPred, h2hPred, homeTeam, awayTeam, homeForm, awayForm) {
    const w      = config.scorePrediction.ensembleWeights;
    const lH     = safeNum(poissonPred?.lambdaHome, 1.5);
    const lA     = safeNum(poissonPred?.lambdaAway, 1.0);
    const maxG   = config.scorePrediction.maxGoals;

    const scoreProbs = [];
    for (let h = 0; h <= maxG; h++) {
      for (let a = 0; a <= maxG; a++) {
        if (h + a > maxG) continue;

        const pPoisson = poissonProb(lH, h) * poissonProb(lA, a);
        const pH2H     = h2hPred?.commonScores
          ? (h2hPred.commonScores.find(s => s.score === `${h}:${a}`)?.frequency || 0.01)
          : 0.01;
        const pForm    = this._formProb(homeForm, awayForm, h, a);
        const pPattern = this._patternProb(homeTeam, awayTeam, h, a);

        const prob =
          Math.pow(pPoisson, w.poisson) *
          Math.pow(pH2H,     w.historical) *
          Math.pow(pForm,    w.form) *
          Math.pow(pPattern, w.pattern);

        scoreProbs.push({ score: `${h}:${a}`, probability: prob, home: h, away: a });
      }
    }

    const total = scoreProbs.reduce((s, x) => s + x.probability, 0);
    if (total > 0) scoreProbs.forEach(s => { s.probability /= total; });

    return scoreProbs.sort((a, b) => b.probability - a.probability);
  }

  _formProb(homeForm, awayForm, homeGoals, awayGoals) {
    const eH = 1.2 * (homeForm / 50);
    const eA = 0.8 * (awayForm / 50);
    return poissonProb(eH, homeGoals) * poissonProb(eA, awayGoals);
  }

  _patternProb(homeTeam, awayTeam, homeGoals, awayGoals) {
    const patterns = this.teamProfiles.get(`${homeTeam}_vs_${awayTeam}`);
    return patterns?.get(`${homeGoals}:${awayGoals}`) || 0.01;
  }

  updateFromMatch(homeTeam, awayTeam, homeGoals, awayGoals) {
    const key     = `${homeTeam}_vs_${awayTeam}`;
    const score   = `${homeGoals}:${awayGoals}`;
    const patterns = this.teamProfiles.get(key) || new Map();
    patterns.set(score, (patterns.get(score) || 0) + 1);
    this.teamProfiles.set(key, patterns);
    this.scorePatterns.set(score, (this.scorePatterns.get(score) || 0) + 1);
  }
}

// ─── EXTRACTEUR DE FEATURES TEMPORELLES ──────────────────────────────────────
class TemporalFeatureExtractor {
  static htStats = new Map();

  static recordHalfTimeStats(homeTeam, awayTeam, goals) {
    if (!goals || !goals.length) return;

    const htGoals = goals.filter(g => (g.minute || 90) <= 45);
    const htLast  = htGoals.length ? htGoals[htGoals.length - 1] : { homeScore: 0, awayScore: 0 };
    const ftLast  = goals[goals.length - 1];

    const hHT = Math.round(htLast.homeScore), aHT = Math.round(htLast.awayScore);
    const hFT = Math.round(ftLast.homeScore), aFT = Math.round(ftLast.awayScore);
    const h2H = hFT - hHT, a2H = aFT - aHT;

    for (const [team, s1H, c1H, s2H, c2H] of [
      [homeTeam, hHT, aHT, h2H, a2H],
      [awayTeam, aHT, hHT, a2H, h2H]
    ]) {
      const s = TemporalFeatureExtractor.htStats.get(team) ||
        { scored1H: 0, conceded1H: 0, scored2H: 0, conceded2H: 0, matches: 0 };
      s.scored1H   += s1H; s.conceded1H += c1H;
      s.scored2H   += s2H; s.conceded2H += c2H;
      s.matches++;
      TemporalFeatureExtractor.htStats.set(team, s);
    }
  }

  _getHalfTimeRate(team, half = '1H') {
    const s = TemporalFeatureExtractor.htStats.get(team);
    if (!s || s.matches < 3) return 0.5;
    const scored   = half === '1H' ? s.scored1H   : s.scored2H;
    const conceded = half === '1H' ? s.conceded1H : s.conceded2H;
    const total    = scored + conceded;
    return total > 0 ? scored / total : 0.5;
  }

  extractFeatures(homeTeam, awayTeam, data) {
    const allMatches  = this._getAllMatches(data);
    const homeMatches = allMatches.filter(m => m.homeTeam === homeTeam || m.awayTeam === homeTeam);
    const awayMatches = allMatches.filter(m => m.homeTeam === awayTeam || m.awayTeam === awayTeam);

    return {
      homeRestDays:   4,
      awayRestDays:   4,
      homeMatchLoad:  this._matchLoad(homeMatches.slice(-5)),
      awayMatchLoad:  this._matchLoad(awayMatches.slice(-5)),
      homeStreak:     this._currentStreak(homeTeam, homeMatches),
      awayStreak:     this._currentStreak(awayTeam, awayMatches),
      homeFirstHalf:  this._getHalfTimeRate(homeTeam, '1H'),
      awayFirstHalf:  this._getHalfTimeRate(awayTeam, '1H'),
      homeSecondHalf: this._getHalfTimeRate(homeTeam, '2H'),
      awaySecondHalf: this._getHalfTimeRate(awayTeam, '2H')
    };
  }

  _getAllMatches(data) {
    const matches = [];
    for (const round of data.results?.rounds || []) {
      for (const match of round.matches || []) {
        if (!match.goals?.length) continue;
        const last = match.goals[match.goals.length - 1];
        matches.push({
          homeTeam:  match.homeTeam?.name,
          awayTeam:  match.awayTeam?.name,
          homeGoals: last.homeScore,
          awayGoals: last.awayScore,
          date:      match.date
        });
      }
    }
    return matches;
  }

  _matchLoad(matches) {
    if (!matches.length) return 1.0;
    return matches.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0) / matches.length;
  }

  _currentStreak(team, matches) {
    let streak = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m   = matches[i];
      const won = (m.homeTeam === team && m.homeGoals > m.awayGoals) ||
                  (m.awayTeam === team && m.awayGoals > m.homeGoals);
      if (won) streak++;
      else break;
    }
    return streak;
  }
}

// ─── SYSTÈME D'APPRENTISSAGE AUTOMATIQUE ─────────────────────────────────────
class AutoLearningSystem {
  constructor() {
    // ─── Poids de base des modèles ──────────────────────────────────────────
    this.weights = { elo: 0.38, poisson: 0.32, market: 0.18, h2h: 0.12 };

    // ─── Historique de performance par modèle ──────────────────────────────
    this.performance = { elo: [], poisson: [], market: [], h2h: [] };

    // ─── Variance par modèle ────────────────────────────────────────────────
    this.modelVariance = { elo: 0.1, poisson: 0.1, market: 0.15, h2h: 0.2 };

    // ─── Métriques globales ─────────────────────────────────────────────────
    this.metrics = {
      totalPredictions: 0, correctPredictions: 0, accuracy: 0.5,
      lastAdjustment: Date.now(),
      modelAccuracy: { elo: 0.5, poisson: 0.5, market: 0.5, h2h: 0.5 },
      vflSpecific: { patternAccuracy: 0.5, biasAdjusted: 0, cyclesDetected: 0 },
      scoreAccuracy: 0, goalAccuracy: 0,
      scoreMetrics:  { exact: 0, within1: 0, winner: 0 }
    };

    // ─── Avantage domicile ──────────────────────────────────────────────────
    this.homeAdvantage = { base: 0.18, byTeam: new Map() };

    // ─── Taux d'apprentissage ───────────────────────────────────────────────
    this.learningRates = {
      elo:     { k: 40, min: 30, max: 48 },
      poisson: { alpha: 0.15, min: 0.08, max: 0.25 },
      weights: { adjustmentRate: 0.04 }
    };

    // ─── AMÉLIORATION 1 : Résultats récents ─────────────────────────────────
    this.recentResults = [];

    // ─── AMÉLIORATION 2 : Multiplicateurs contextuels appris ────────────────
    this.contextWeightPerf = {
      bigMatch: { elo: [], poisson: [], market: [], h2h: [] },
      derby:    { elo: [], poisson: [], market: [], h2h: [] },
      revenge:  { elo: [], poisson: [], market: [], h2h: [] },
      streak:   { elo: [], poisson: [], market: [], h2h: [] },
      mismatch: { elo: [], poisson: [], market: [], h2h: [] },
      normal:   { elo: [], poisson: [], market: [], h2h: [] }
    };
    this.contextMultipliers = {
      bigMatch: { elo: 1.15, poisson: 0.95, market: 0.90, h2h: 1.10 },
      derby:    { elo: 0.90, poisson: 0.95, market: 1.00, h2h: 1.25 },
      revenge:  { elo: 1.10, poisson: 1.05, market: 0.95, h2h: 1.15 },
      streak:   { elo: 1.20, poisson: 0.90, market: 1.10, h2h: 0.90 },
      mismatch: { elo: 1.10, poisson: 1.15, market: 0.90, h2h: 0.85 },
      normal:   { elo: 1.00, poisson: 1.00, market: 1.00, h2h: 1.00 }
    };

    // ─── AMÉLIORATION 3 : UCB ───────────────────────────────────────────────
    this.ucb = {
      elo:     { pulls: 1, rewards: 0.5 },
      poisson: { pulls: 1, rewards: 0.5 },
      market:  { pulls: 1, rewards: 0.5 },
      h2h:     { pulls: 1, rewards: 0.5 }
    };

    // ─── AMÉLIORATION 4 : Calibration de confiance ─────────────────────────
    this.confidenceCalibration = {
      '30': { predicted: 0, correct: 0 },
      '40': { predicted: 0, correct: 0 },
      '50': { predicted: 0, correct: 0 },
      '60': { predicted: 0, correct: 0 },
      '70': { predicted: 0, correct: 0 },
      '80': { predicted: 0, correct: 0 },
      '90': { predicted: 0, correct: 0 }
    };

    // ─── AMÉLIORATION 5 : Apprentissage du demi-temps ───────────────────────
    this.htLearning = {
      total: 0, correct: 0, accuracy: 0,
      convergentTotal: 0, convergentCorrect: 0
    };

    // ─── AMÉLIORATION 6 : Profils de style de jeu par équipe ────────────────
    this.teamStyles = new Map();

    // ========== 🔥 NOUVEAU : Forces Poisson persistées ==========
    // On stocke les forces d'attaque et de défense pour chaque équipe
    this.poissonForces = {
      attack: new Map(),   // Map<team, attackStrength>
      defense: new Map()   // Map<team, defenseStrength>
    };
    // ============================================================

    this._saveTimeout  = null;
    this._initialized  = false;

    // Sous-composants
    this.scoreAnalyzer          = new ScoreDistributionAnalyzer();
    this.scoreCalibrator        = new ScoreCalibrator();
    this.scoreMetricsTracker    = new ScoreMetricsTracker();
    this.advancedScorePredictor = new AdvancedScorePredictor();
    this.temporalExtractor      = new TemporalFeatureExtractor();
    this.goalLearning           = new GoalLearningSystem();
  }

  async initialize() {
    if (this._initialized) return;
    try {
      const saved = await LearningState.findOne({
        order: [['createdAt', 'DESC']],
        attributes: ['weights', 'metrics', 'homeAdvantageBase', 'homeAdvantageByTeam', 'learningRates', 'extraState']
      });
      if (saved) {
        if (saved.weights)       this.weights       = saved.weights;
        if (saved.metrics)       this.metrics       = saved.metrics;
        if (saved.learningRates) this.learningRates = saved.learningRates;
        this.homeAdvantage.base = saved.homeAdvantageBase ?? this.homeAdvantage.base;
        if (saved.homeAdvantageByTeam) {
          this.homeAdvantage.byTeam = new Map(Object.entries(saved.homeAdvantageByTeam));
        }
        
        // Restaurer l'état étendu
        const ex = saved.extraState || {};
        if (ex.contextMultipliers)    this.contextMultipliers    = ex.contextMultipliers;
        if (ex.ucb)                   this.ucb                   = ex.ucb;
        if (ex.confidenceCalibration) this.confidenceCalibration = ex.confidenceCalibration;
        if (ex.htLearning)            this.htLearning            = ex.htLearning;
        if (ex.recentResults)         this.recentResults         = ex.recentResults;
        if (ex.teamStyles)            this.teamStyles = new Map(Object.entries(ex.teamStyles));
        
        // ========== 🔥 NOUVEAU : Chargement des forces Poisson ==========
        if (ex.poissonForces) {
          // Convertir les objets en Maps
          this.poissonForces = {
            attack: new Map(Object.entries(ex.poissonForces.attack || {})),
            defense: new Map(Object.entries(ex.poissonForces.defense || {}))
          };
          logger.info(`Forces Poisson chargées: ${this.poissonForces.attack.size} équipes en attaque, ${this.poissonForces.defense.size} en défense`);
        }
        // ================================================================

        logger.info('État VFL chargé', {
          accuracy:     Math.round((this.metrics.accuracy     || 0) * 100) + '%',
          goalAccuracy: Math.round((this.metrics.goalAccuracy || 0) * 100) + '%',
          predictions:  this.metrics.totalPredictions
        });
      }
    } catch (err) {
      logger.error('Erreur chargement état VFL:', err);
    } finally {
      this._initialized = true;
    }
  }

  queueSave() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(async () => {
      try {
        // ========== 🔥 NOUVEAU : Convertir les Maps Poisson en objets ==========
        const attackObj = {};
        const defenseObj = {};
        
        for (const [team, value] of this.poissonForces.attack) {
          attackObj[team] = value;
        }
        for (const [team, value] of this.poissonForces.defense) {
          defenseObj[team] = value;
        }
        // =======================================================================

        await LearningState.create({
          weights:             this.weights,
          metrics:             this.metrics,
          homeAdvantageBase:   this.homeAdvantage.base,
          homeAdvantageByTeam: Object.fromEntries(this.homeAdvantage.byTeam),
          learningRates:       this.learningRates,
          timestamp:           Date.now(),
          extraState: {
            contextMultipliers:    this.contextMultipliers,
            ucb:                   this.ucb,
            confidenceCalibration: this.confidenceCalibration,
            htLearning:            this.htLearning,
            recentResults:         this.recentResults.slice(-60),
            teamStyles:            Object.fromEntries(this.teamStyles),
            // ========== 🔥 NOUVEAU : Sauvegarde des forces Poisson ==========
            poissonForces: {
              attack: attackObj,
              defense: defenseObj
            }
            // ================================================================
          }
        });
        logger.info('État VFL sauvegardé');
      } catch (err) {
        logger.error('Erreur sauvegarde état VFL:', err);
      }
      this._saveTimeout = null;
    }, config.db.saveDelay);
  }

  // ─── recordPrediction ──────────────────────────────────────────────────────
  async recordPrediction(prediction, actualResult, modelContributions, actualGoals = null, actualScore = null, context = null, actualHalfTime = null) {
    if (!prediction) return;
    try {
      this.metrics.totalPredictions++;
      const wasCorrect = prediction.final_result === actualResult;
      if (wasCorrect) this.metrics.correctPredictions++;
      this.metrics.accuracy = this.metrics.correctPredictions / this.metrics.totalPredictions;

      this.recentResults.push(wasCorrect ? 1 : 0);
      if (this.recentResults.length > 60) this.recentResults.shift();

      safeMetric(() => metrics.accuracyGauge.set(this.metrics.accuracy));
      safeMetric(() => metrics.predictionsTotal.labels(actualResult || 'unknown').inc());

      if (prediction.confidence) {
        const slot = Math.floor(prediction.confidence / 10) * 10;
        const key  = String(Math.min(90, Math.max(30, slot)));
        if (this.confidenceCalibration[key]) {
          this.confidenceCalibration[key].predicted++;
          if (wasCorrect) this.confidenceCalibration[key].correct++;
        }
      }

      if (actualScore && prediction.exact_score) {
        this.scoreMetricsTracker.record(
          prediction.exact_score, actualScore,
          prediction.confidence, prediction.goals, actualGoals
        );
        this.scoreCalibrator.recordPrediction(prediction.exact_score, actualScore, prediction.confidence);
        this.scoreCalibrator.recordGoalPrediction(prediction.goals, actualGoals, context);
        this.metrics.scoreAccuracy = this.scoreMetricsTracker.getExactAccuracy();
        this.metrics.goalAccuracy  = this.scoreMetricsTracker.getGoalsExactAccuracy();

        const [homeTeam, awayTeam] = prediction.match.split(' vs ');
        const [hG, aG] = actualScore.split(':').map(Number);
        this.advancedScorePredictor.updateFromMatch(homeTeam, awayTeam, hG, aG);
        this.goalLearning.recordMatch(homeTeam, awayTeam, hG, aG, context);

        this._updateTeamStyle(homeTeam, hG, aG);
        this._updateTeamStyle(awayTeam, aG, hG);
      }

      if (actualHalfTime && prediction.half_time) {
        this.htLearning.total++;
        const htCorrect = prediction.half_time === actualHalfTime;
        if (htCorrect) this.htLearning.correct++;
        this.htLearning.accuracy = this.htLearning.correct / this.htLearning.total;
        if (prediction.half_time === prediction.final_result) {
          this.htLearning.convergentTotal++;
          if (wasCorrect) this.htLearning.convergentCorrect++;
        }
      }

      const ctxKey = this._contextKey(context);
      for (const [model, contribution] of Object.entries(modelContributions || {})) {
        if (contribution > 0.1 && this.performance[model]) {
          const perf = this.performance[model];
          perf.push(wasCorrect ? 1 : 0);
          if (perf.length > config.learning.performanceWindow) perf.shift();

          if (this.ucb[model]) {
            this.ucb[model].pulls++;
            if (wasCorrect) this.ucb[model].rewards++;
          }

          if (this.contextWeightPerf[ctxKey]?.[model]) {
            this.contextWeightPerf[ctxKey][model].push(wasCorrect ? 1 : 0);
            if (this.contextWeightPerf[ctxKey][model].length > 30)
              this.contextWeightPerf[ctxKey][model].shift();
          }

          if (perf.length > 10) {
            const mean     = perf.reduce((a, b) => a + b, 0) / perf.length;
            const variance = perf.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / perf.length;
            this.modelVariance[model] = Math.min(0.3, variance);
          }
        }
      }

      const n = this.metrics.totalPredictions;
      if (n >= config.learning.minPredictionsForAdjustment && n % config.learning.adjustmentInterval === 0) {
        await this._adjustWeights();
        this._adjustContextMultipliers();
        this._detectRegimeChange();
      }
      if (n % config.learning.saveInterval === 0) this.queueSave();

      await this._adjustHomeAdvantage(prediction, actualResult);
    } catch (err) {
      logger.error('Erreur dans recordPrediction:', err);
    }
  }

  // ─── _adjustWeights ────────────────────────────────────────────────────────
  async _adjustWeights() {
    const globalAcc  = this.metrics.accuracy;
    const totalPulls = Object.values(this.ucb).reduce((s, u) => s + u.pulls, 0);
    const rate       = 0.01;
    const BOUNDS     = {
      elo:     { min: 0.20, max: 0.55 },
      poisson: { min: 0.15, max: 0.45 },
      market:  { min: 0.08, max: 0.28 },
      h2h:     { min: 0.04, max: 0.22 }
    };

    for (const model of ['elo', 'poisson', 'market', 'h2h']) {
      const recentAcc = this._weightedAccuracy(this.performance[model]);
      const bounds    = BOUNDS[model];

      if      (recentAcc > globalAcc + 0.08) this.weights[model] = Math.min(bounds.max, this.weights[model] + rate);
      else if (recentAcc < globalAcc - 0.08) this.weights[model] = Math.max(bounds.min, this.weights[model] - rate);

      if (this.ucb[model] && totalPulls > 10) {
        const avgReward = this.ucb[model].rewards / this.ucb[model].pulls;
        const explore   = Math.sqrt(2 * Math.log(totalPulls) / this.ucb[model].pulls);
        const ucbScore  = avgReward + explore * 0.02;
        this.weights[model] = Math.min(bounds.max, this.weights[model] + ucbScore * 0.003);
      }

      this.metrics.modelAccuracy[model] = recentAcc;
    }

    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
    if (sum > 0) for (const k in this.weights) this.weights[k] /= sum;
    this.metrics.lastAdjustment = Date.now();
    logger.info('Poids modèles ajustés', {
      elo: this.weights.elo.toFixed(3), poisson: this.weights.poisson.toFixed(3),
      market: this.weights.market.toFixed(3), h2h: this.weights.h2h.toFixed(3)
    });
  }

  _weightedAccuracy(results) {
    if (!results || results.length === 0) return 0.5;
    let sumW = 0, sumWR = 0;
    results.forEach((r, i) => {
      const age = results.length - i;
      const w   = Math.exp(-0.02 * age);
      sumW  += w;
      sumWR += w * r;
    });
    return sumW > 0 ? sumWR / sumW : 0.5;
  }

  _detectRegimeChange() {
    if (this.recentResults.length < 60) return;
    const last30  = this.recentResults.slice(-30);
    const prev30  = this.recentResults.slice(-60, -30);
    const acc30   = last30.reduce((a, b) => a + b, 0)  / 30;
    const accPrev = prev30.reduce((a, b) => a + b, 0)  / 30;

    if (Math.abs(acc30 - accPrev) > 0.18) {
      logger.warn(`⚠️ Rupture de régime — acc30=${Math.round(acc30*100)}% vs prev30=${Math.round(accPrev*100)}% — reset partiel`);
      this.weights     = { elo: 0.38, poisson: 0.32, market: 0.18, h2h: 0.12 };
      this.performance = { elo: [], poisson: [], market: [], h2h: [] };
      for (const m in this.ucb) this.ucb[m] = { pulls: 1, rewards: 0.5 };
      this.metrics.vflSpecific.cyclesDetected++;
      this.queueSave();
    }
  }

  _adjustContextMultipliers() {
    const rate = 0.03;
    for (const ctx of Object.keys(this.contextWeightPerf)) {
      for (const model of ['elo', 'poisson', 'market', 'h2h']) {
        const perf = this.contextWeightPerf[ctx][model];
        if (perf.length < 10) continue;
        const ctxAcc    = this._weightedAccuracy(perf);
        const globalAcc = this._weightedAccuracy(this.performance[model]);
        const current   = this.contextMultipliers[ctx]?.[model] || 1.0;
        if      (ctxAcc > globalAcc + 0.08) this.contextMultipliers[ctx][model] = Math.min(1.5, current + rate);
        else if (ctxAcc < globalAcc - 0.08) this.contextMultipliers[ctx][model] = Math.max(0.6, current - rate);
      }
    }
  }

  _updateTeamStyle(team, scored, conceded) {
    const s = this.teamStyles.get(team) || {
      totalScored: 0, totalConceded: 0, matches: 0, cleanSheets: 0, highScoreGames: 0
    };
    s.totalScored   += scored;
    s.totalConceded += conceded;
    s.matches++;
    if (conceded === 0)        s.cleanSheets++;
    if (scored + conceded >= 4) s.highScoreGames++;
    this.teamStyles.set(team, s);
  }

  getTeamStyle(team) {
    const s = this.teamStyles.get(team);
    if (!s || s.matches < 5) return null;
    return {
      avgScored:      s.totalScored   / s.matches,
      avgConceded:    s.totalConceded / s.matches,
      cleanSheetRate: s.cleanSheets   / s.matches,
      highScoreRate:  s.highScoreGames/ s.matches,
      matches:        s.matches
    };
  }

  computeUncertaintyScore(finalProb, h2hCount = 0, variance = 0) {
    const gap    = Math.abs(finalProb.home - finalProb.away);
    const maxP   = Math.max(finalProb.home, finalProb.draw, finalProb.away);
    const lowH2H = h2hCount < 3  ? 0.4 : 0;
    const lowGap = gap < 0.05    ? 0.3 : 0;
    const highVar= variance > 0.05? 0.2 : 0;
    const lowMax = maxP < 0.40   ? 0.2 : 0;
    return Math.min(1, lowH2H + lowGap + highVar + lowMax);
  }

  getCalibratedConfidence(rawConfidence) {
    const slot = Math.min(90, Math.max(30, Math.floor(rawConfidence / 10) * 10));
    const data = this.confidenceCalibration[String(slot)];
    if (!data || data.predicted < 20) return rawConfidence;
    const realRate  = data.correct / data.predicted;
    const predicted = rawConfidence / 100;
    return clamp(Math.round((realRate * 0.7 + predicted * 0.3) * 100),
      CONSTANTS.MIN_CONFIDENCE, CONSTANTS.MAX_CONFIDENCE);
  }

  getHTConfidenceAdjustment(htPrediction, ftPrediction) {
    if (!htPrediction || !ftPrediction) return 0;

    if (htPrediction === ftPrediction) {
      const convAcc = this.htLearning.convergentTotal > 10
        ? this.htLearning.convergentCorrect / this.htLearning.convergentTotal
        : 0.70;

      if      (convAcc > 0.65) return +8;
      else if (convAcc > 0.55) return +5;
      else if (convAcc < 0.45) return -3;
      return +3;
    }

    return -4;
  }

  async _adjustHomeAdvantage(prediction, actualResult) {
    const matchStr = prediction?.match || '';
    if (!matchStr.includes(' vs ')) return;
    const homeTeam      = matchStr.split(' vs ')[0];
    const wasHomeWin    = actualResult === '1';
    const predictedHome = prediction.final_result === '1';

    if      (wasHomeWin && !predictedHome) this.homeAdvantage.base += 0.004;
    else if (!wasHomeWin && predictedHome) this.homeAdvantage.base -= 0.003;
    this.homeAdvantage.base = clamp(
      this.homeAdvantage.base, config.vfl.homeAdvantageMin, config.vfl.homeAdvantageMax
    );

    const teamAdv  = this.homeAdvantage.byTeam.get(homeTeam) || this.homeAdvantage.base;
    let newTeamAdv = teamAdv;
    if      (wasHomeWin && !predictedHome) newTeamAdv += 0.007;
    else if (!wasHomeWin && predictedHome) newTeamAdv -= 0.005;
    newTeamAdv = clamp(newTeamAdv, 0.10, 0.35);
    this.homeAdvantage.byTeam.set(homeTeam, newTeamAdv);
    if (Math.abs(newTeamAdv - teamAdv) > 0.015) this.queueSave();
  }

  _contextKey(ctx = {}) {
    if (!ctx) return 'normal';
    if (ctx.bigMatch) return 'bigMatch';
    if (ctx.derby)    return 'derby';
    if (ctx.revenge)  return 'revenge';
    if (ctx.streak)   return 'streak';
    if (ctx.mismatch) return 'mismatch';
    return 'normal';
  }

  getHomeAdvantage(team) {
    return this.homeAdvantage.byTeam.get(team) || this.homeAdvantage.base;
  }

  adjustKFactor(currentK, team, gamesPlayed) {
    if (gamesPlayed < 8)  return 48;
    if (gamesPlayed < 20) return 42;
    return this.metrics.modelAccuracy.elo > 0.60 ? 32 : 38;
  }

  adjustPoissonAlpha(currentAlpha) {
    return this.metrics.modelAccuracy.poisson > 0.60
      ? Math.max(0.08, currentAlpha * 0.92)
      : currentAlpha;
  }

  getWeights(context = {}) {
    const w      = { ...this.weights };
    const ctxKey = this._contextKey(context);
    const mults  = this.contextMultipliers[ctxKey] || this.contextMultipliers.normal;
    for (const model of ['elo', 'poisson', 'market', 'h2h']) {
      w[model] *= (mults[model] || 1.0);
    }
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    if (sum > 0) for (const k in w) w[k] /= sum;
    return w;
  }

  getModelReliability() {
    return {
      elo:     1 - (this.modelVariance.elo     || 0),
      poisson: 1 - (this.modelVariance.poisson  || 0),
      market:  1 - (this.modelVariance.market   || 0.15),
      h2h:     1 - (this.modelVariance.h2h      || 0.2)
    };
  }

  getLearningStats() {
    return {
      accuracy:              this.metrics.accuracy,
      totalPredictions:      this.metrics.totalPredictions,
      modelAccuracy:         this.metrics.modelAccuracy,
      homeAdvantage:         this.homeAdvantage.base,
      weights:               this.weights,
      variance:              this.modelVariance,
      scoreMetrics:          this.scoreMetricsTracker.getDetailedMetrics(),
      calibration:           this.scoreCalibrator.getCalibrationStats(),
      commonScores:          this.scoreAnalyzer.getMostLikelyScores(5),
      goalRangeDistribution: this.scoreAnalyzer.getGoalRangeDistribution(),
      confidenceCalibration: this.confidenceCalibration,
      htAccuracy:            this.htLearning.accuracy,
      htConvergentAccuracy:  this.htLearning.convergentTotal > 0
        ? this.htLearning.convergentCorrect / this.htLearning.convergentTotal : 0,
      contextMultipliers:    this.contextMultipliers,
      regimeStatus: {
        recentAcc: this.recentResults.length >= 30
          ? Math.round(this.recentResults.slice(-30).reduce((a,b)=>a+b,0) / 30 * 100) + '%'
          : 'insufficient_data',
        cyclesDetected: this.metrics.vflSpecific.cyclesDetected
      }
    };
  }

  updateScoreDistribution(h, a)    { this.scoreAnalyzer.updateFromMatch(h, a); }
  getScoreCalibrator()             { return this.scoreCalibrator; }
  getScoreAnalyzer()               { return this.scoreAnalyzer; }
  getAdvancedScorePredictor()      { return this.advancedScorePredictor; }
  getTemporalFeatureExtractor()    { return this.temporalExtractor; }
  getGoalLearning()                { return this.goalLearning; }
}

// ─── SYSTÈME ELO ─────────────────────────────────────────────────────────────
class EloSystem {
  constructor(learningSystem) {
    this.learning     = learningSystem;
    this.ratings      = new Map();
    this.gamesPlayed  = new Map();
    this._saveTimeout = null;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;
    try {
      const rows = await Rating.findAll({ attributes: ['team', 'rating', 'games'] });
      if (rows.length > 0) {
        rows.forEach(r => {
          this.ratings.set(r.team, r.rating);
          this.gamesPlayed.set(r.team, r.games);
        });
        logger.info(`${rows.length} ratings VFL chargés`);
      } else {
        this._initDefaults();
      }
    } catch (err) {
      logger.error('Erreur chargement ratings Elo:', err);
      this._initDefaults();
    } finally {
      this._initialized = true;
    }
  }

  _initDefaults() {
    const defaults = {
      'Liverpool': 1720, 'London Reds': 1710, 'Manchester Blue': 1700,
      'Newcastle': 1690, 'West Ham': 1680,    'Brentford': 1670,
      'Brighton': 1660,  'Bournemouth': 1650, 'London Blues': 1640,
      'N. Forest': 1630, 'Wolverhampton': 1620,'A. Villa': 1610,
      'Manchester Red': 1600, 'Spurs': 1590,  'Fulham': 1580,
      'Everton': 1570,   'Burnley': 1560,     'C. Palace': 1550,
      'Leeds': 1540,     'Sunderland': 1530
    };
    for (const [team, rating] of Object.entries(defaults)) {
      this.ratings.set(team, rating);
      this.gamesPlayed.set(team, 0);
    }
  }

  queueSave() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(async () => {
      try {
        const data = Array.from(this.ratings.entries()).map(([team, rating]) => ({
          team,
          rating: Math.round(rating * 100) / 100,
          games:  this.gamesPlayed.get(team) || 0
        }));
        await Rating.bulkCreate(data, {
          updateOnDuplicate: ['rating', 'games', 'updatedAt'],
          batchSize: config.db.batchSize
        });
        logger.info('Ratings VFL sauvegardés');
      } catch (err) {
        logger.error('Erreur sauvegarde ratings:', err);
      }
      this._saveTimeout = null;
    }, config.db.saveDelay);
  }

  getRating(team)      { return this.ratings.get(team)     || CONSTANTS.DEFAULT_ELO; }
  getGamesPlayed(team) { return this.gamesPlayed.get(team) || 0; }

  _expectedScore(rA, rB, homeAdv = 0) {
    return 1 / (1 + Math.pow(10, (rB - rA - homeAdv) / 400));
  }

  predict(homeTeam, awayTeam) {
    try {
      const hR  = this.getRating(homeTeam);
      const aR  = this.getRating(awayTeam);
      const adv = this.learning ? (this.learning.getHomeAdvantage(homeTeam) * 100) : 0;

      const eH  = this._expectedScore(hR, aR,  adv);
      const eA  = this._expectedScore(aR, hR, -adv);
      const dP  = Math.max(0.10, 0.25 - (Math.abs(hR - aR) / 2000));
      const sum = eH + eA + dP;

      return {
        home: sum > 0 ? eH  / sum : 0.33,
        draw: sum > 0 ? dP  / sum : 0.34,
        away: sum > 0 ? eA  / sum : 0.33,
        homeRating: hR, awayRating: aR
      };
    } catch (err) {
      logger.error('Erreur prédiction Elo:', err);
      return { ...FALLBACK_PREDICTION };
    }
  }

  async updateFromResult(homeTeam, awayTeam, result, homeGoals, awayGoals) {
    try {
      const hR      = this.getRating(homeTeam);
      const aR      = this.getRating(awayTeam);
      const hGames  = this.getGamesPlayed(homeTeam);
      const k       = this.learning ? this.learning.adjustKFactor(40, homeTeam, hGames) : 40;
      const adv     = this.learning ? (this.learning.getHomeAdvantage(homeTeam) * 100) : 0;
      const eH      = this._expectedScore(hR, aR, adv);
      const diff    = Math.abs(homeGoals - awayGoals);
      const bonus   = 1 + (diff >= 3 ? 0.4 : diff >= 2 ? 0.25 : 0.1);

      this.ratings.set(homeTeam, hR + k * bonus * (result - eH));
      this.ratings.set(awayTeam, aR + k * bonus * ((1 - result) - (1 - eH)));
      this.gamesPlayed.set(homeTeam, hGames + 1);
      this.gamesPlayed.set(awayTeam, this.getGamesPlayed(awayTeam) + 1);

      if ((hGames + this.getGamesPlayed(awayTeam)) % 10 === 0) this.queueSave();
    } catch (err) {
      logger.error('Erreur updateFromResult Elo:', err);
    }
  }
}

// ─── MODÈLE POISSON ───────────────────────────────────────────────────────────
class PoissonModel {
  constructor(learningSystem) {
    this.learning = learningSystem;
    
    // ========== 🔥 MODIFIÉ : Utiliser les forces persistées ==========
    // Si le learning system a des forces, on les utilise
    if (learningSystem && learningSystem.poissonForces) {
      this.attackStrength = learningSystem.poissonForces.attack;
      this.defenseStrength = learningSystem.poissonForces.defense;
      logger.info(`Modèle Poisson initialisé avec forces persistées: ${this.attackStrength.size} équipes`);
    } else {
      // Fallback si pas de forces (premier démarrage)
      this.attackStrength = new Map();
      this.defenseStrength = new Map();
      this._initStrengths();
    }
    // ================================================================
  }

  _initStrengths() {
    const teams = [
      'London Reds','Liverpool','Manchester Blue','Newcastle','West Ham',
      'Brentford','Brighton','Bournemouth','London Blues','N. Forest',
      'Wolverhampton','A. Villa','Manchester Red','Spurs','Fulham',
      'Everton','Burnley','C. Palace','Leeds','Sunderland'
    ];
    teams.forEach(t => {
      this.attackStrength.set(t, 1.3);
      this.defenseStrength.set(t, 1.3);
    });
  }

  getAttack(team)  { return this.attackStrength.get(team)  || 1.3; }
  getDefense(team) { return this.defenseStrength.get(team) || 1.3; }

  _scoreMatrix(lH, lA, maxGoals = 6) {
    const matrix = [];
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        if (h + a > maxGoals) continue;
        matrix.push({ home: h, away: a, probability: poissonProb(lH, h) * poissonProb(lA, a) });
      }
    }
    return matrix.sort((a, b) => b.probability - a.probability);
  }

  predict(homeTeam, awayTeam, biasCorrector = null, learningSystemRef = null) {
    try {
      const hAdv = this.learning ? this.learning.getHomeAdvantage(homeTeam) : 0.18;
      let lH = this.getAttack(homeTeam)  * this.getDefense(awayTeam) * (1.25 + hAdv * 0.4);
      let lA = this.getAttack(awayTeam)  * this.getDefense(homeTeam) * (1.10 - hAdv * 0.15);

      const ref = learningSystemRef || this.learning;
      if (ref && ref.getTeamStyle) {
        const hStyle = ref.getTeamStyle(homeTeam);
        const aStyle = ref.getTeamStyle(awayTeam);
        if (hStyle) {
          lH = lH * 0.7 + hStyle.avgScored * 0.3;
          if (hStyle.cleanSheetRate > 0.35) lA *= (1 - hStyle.cleanSheetRate * 0.3);
        }
        if (aStyle) {
          lA = lA * 0.7 + aStyle.avgScored * 0.3;
          if (aStyle.cleanSheetRate > 0.35) lH *= (1 - aStyle.cleanSheetRate * 0.3);
        }
        lH = clamp(lH, 0.3, 3.5);
        lA = clamp(lA, 0.3, 3.5);
      }

      const matrix = this._scoreMatrix(lH, lA, 6);
      let hW = 0, d = 0, aW = 0;
      for (const { home, away, probability } of matrix) {
        if      (home > away) hW += probability;
        else if (home < away) aW += probability;
        else                  d  += probability;
      }
      const total = hW + d + aW;

      let pred = {
        home:          total > 0 ? hW / total : 0.33,
        draw:          total > 0 ? d  / total : 0.34,
        away:          total > 0 ? aW / total : 0.33,
        expectedGoals: lH + lA,
        mostLikelyScore: matrix.length ? `${matrix[0].home}:${matrix[0].away}` : '1:1',
        lambdaHome: lH, lambdaAway: lA,
        scoreMatrix: matrix.slice(0, 10)
      };

      if (biasCorrector) {
        const corrected = biasCorrector.correct(pred);
        pred = { ...pred, ...corrected };
      }

      return pred;
    } catch (err) {
      logger.error('Erreur prédiction Poisson:', err);
      return { ...FALLBACK_PREDICTION, scoreMatrix: [] };
    }
  }

  // ========== 🔥 MODIFIÉ : Notifier le learning system après mise à jour ==========
  async _notifyLearningSystem() {
    if (this.learning && this.learning.queueSave) {
      // Les Maps sont partagées (même référence), donc les forces sont déjà à jour
      // On force juste une sauvegarde
      this.learning.queueSave();
    }
  }

  async updateFromResult(homeTeam, awayTeam, homeGoals, awayGoals) {
    try {
      const alpha = this.learning
        ? this.learning.adjustPoissonAlpha(this.learning.learningRates.poisson.alpha)
        : 0.15;
      const hAdv  = this.learning ? this.learning.getHomeAdvantage(homeTeam) : 0.18;

      const eH = this.getAttack(homeTeam) * this.getDefense(awayTeam) * (1.25 + hAdv * 0.4);
      const eA = this.getAttack(awayTeam) * this.getDefense(homeTeam) * (1.10 - hAdv * 0.15);

      this.attackStrength.set(homeTeam,  Math.max(0.5, this.getAttack(homeTeam)  + alpha * 1.2 * (homeGoals - eH)));
      this.defenseStrength.set(awayTeam, Math.max(0.5, this.getDefense(awayTeam) - alpha * 1.2 * (homeGoals - eH)));
      this.attackStrength.set(awayTeam,  Math.max(0.5, this.getAttack(awayTeam)  + alpha * 1.2 * (awayGoals - eA)));
      this.defenseStrength.set(homeTeam, Math.max(0.5, this.getDefense(homeTeam) - alpha * 1.2 * (awayGoals - eA)));

      if (this.learning) this.learning.learningRates.poisson.alpha = alpha;
      
      // 🔥 Forcer une sauvegarde des forces
      await this._notifyLearningSystem();
      
    } catch (err) {
      logger.error('Erreur updateFromResult Poisson:', err);
    }
  }
  // =============================================================================
}

// ─── DÉTECTEUR DE CONTEXTE ────────────────────────────────────────────────────
class ContextDetector {
  detectContext(homeTeam, awayTeam, data) {
    const ctx = { bigMatch: false, derby: false, revenge: false, streak: false, mismatch: false };
    const home = data.ranking?.teams?.find(t => t.name === homeTeam);
    const away = data.ranking?.teams?.find(t => t.name === awayTeam);
    if (!home || !away) return ctx;

    ctx.bigMatch = home.position <= 5 && away.position <= 5;

    const DERBY_PAIRS = [
      ['Manchester Red', 'Manchester Blue'],
      ['London Reds',    'London Blues'],
      ['N. Forest',      'Sunderland'],
    ];
    ctx.derby = DERBY_PAIRS.some(([a, b]) =>
      (homeTeam === a && awayTeam === b) ||
      (homeTeam === b && awayTeam === a)
    );
    if (!ctx.derby) {
      ctx.derby = (homeTeam.includes('Manchester') && awayTeam.includes('Manchester')) ||
                  (homeTeam.includes('London')     && awayTeam.includes('London'));
    }

    const last = this._lastMeeting(homeTeam, awayTeam, data);
    if (last) {
      const loser = last.homeGoals > last.awayGoals ? last.awayTeam
                  : last.homeGoals < last.awayGoals ? last.homeTeam
                  : null;
      if (loser) ctx.revenge = (loser === homeTeam || loser === awayTeam);
    }

    ctx.streak = (home.history?.slice(-3) || []).every(r => r === 'Won') ||
                 (away.history?.slice(-3) || []).every(r => r === 'Won');

    ctx.mismatch = Math.abs(home.position - away.position) >= 10;

    return ctx;
  }

  _lastMeeting(homeTeam, awayTeam, data) {
    for (const round of data.results?.rounds || []) {
      const roundNumber = round.roundNumber;
      if (!roundNumber) continue;

      for (const match of round.matches || []) {
        const hN = match.homeTeam?.name, aN = match.awayTeam?.name;
        if (!((hN === homeTeam && aN === awayTeam) ||
              (hN === awayTeam && aN === homeTeam))) continue;

        const playoutById = caches.learning.get(`playout_${roundNumber}`);
        if (playoutById && match.id && playoutById[match.id]) {
          const pm    = playoutById[match.id];
          const goals = pm.goals || [];
          if (goals.length) {
            const last = goals[goals.length - 1];
            return {
              homeTeam: hN, awayTeam: aN,
              homeGoals: Math.round(last.homeScore),
              awayGoals: Math.round(last.awayScore)
            };
          }
        }

        if (match.goals?.length) {
          const last = match.goals[match.goals.length - 1];
          return {
            homeTeam: hN, awayTeam: aN,
            homeGoals: Math.round(last.homeScore),
            awayGoals: Math.round(last.awayScore)
          };
        }
      }
    }
    return null;
  }
}

// ─── GESTIONNAIRE DES SYSTÈMES ────────────────────────────────────────────────
const systems = (() => {
  const learningLazy = new LazySystem(async () => {
    const s = new AutoLearningSystem();
    await s.initialize();
    return s;
  });

  const eloLazy = new LazySystem(async () => {
    const learning = await learningLazy.get();
    const s = new EloSystem(learning);
    await s.initialize();
    return s;
  });

  const poissonLazy = new LazySystem(async () => {
    const learning = await learningLazy.get();
    return new PoissonModel(learning);
  });

  return {
    learning:        learningLazy,
    elo:             eloLazy,
    poisson:         poissonLazy,
    thresholds:      new LazySystem(() => new AdaptiveThresholds()),
    biasCorrector:   new LazySystem(() => new BiasCorrector()),
    contextDetector: new LazySystem(() => new ContextDetector())
  };
})();

// ─── FONCTIONS UTILITAIRES ────────────────────────────────────────────────────
async function fetchWithRetry(url, key, maxRetries = 5) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: HEADERS,
        timeout: config.api.timeout,
        decompress: true
      });

      const data = res.data;

      if (data) caches.api.set(`api_last_good_${key}`, data, 3600);

      return data;

    } catch (err) {
      lastError = err;
      safeMetric(() => metrics.apiErrors.labels(key).inc());

      const delay = 200 * Math.pow(2, attempt - 1);
      logger.warn(`⚠️  API [${key}] tentative ${attempt}/${maxRetries} échouée (${err.code || err.message}) → retry dans ${delay}ms`);

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  const lastGood = caches.api.get(`api_last_good_${key}`);
  if (lastGood) {
    logger.error(`❌ API [${key}] inaccessible après ${maxRetries} tentatives → utilisation dernière réponse connue`);
    return lastGood;
  }

  logger.error(`❌ API [${key}] inaccessible et aucune réponse en cache`);
  throw lastError;
}

async function fetchData() {
  const cacheKey = `api_data_${Math.floor(Date.now() / (config.cache.api * 1000))}`;
  const cached   = caches.api.get(cacheKey);
  if (cached) {
    safeMetric(() => metrics.cacheHits.labels('api').inc());
    return cached;
  }

  const BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
  const URLS = {
    matches: `${BASE}/8035/matches`,
    ranking: `${BASE}/8035/ranking`,
    results: `${BASE}/8035/results?skip=0&take=50`
  };

  try {
    const [matchesRaw, ranking, results] = await Promise.all([
      fetchWithRetry(URLS.matches, 'matches'),
      fetchWithRetry(URLS.ranking, 'ranking'),
      fetchWithRetry(URLS.results, 'results')
    ]);

    const allRounds   = matchesRaw?.rounds || [];
    const bettingRound = allRounds.find(r => (r.matches || []).length > 0) || allRounds[0];

    if (!bettingRound || !bettingRound.matches?.length) {
      logger.warn('Aucun round avec matchs disponible dans /matches');
      return { matches: { rounds: [] }, ranking, results };
    }

    const roundNumber = bettingRound.roundNumber;
    logger.info(`🎯 Round à prédire : ${roundNumber} — ${bettingRound.matches.length} matchs`);

    const data = {
      matches:      { rounds: [bettingRound] },
      ranking,
      results,
      currentRound: roundNumber
    };

    caches.api.set(cacheKey, data);
    return data;

  } catch (err) {
    logger.error('Erreur fetchData:', err);
    return { matches: { rounds: [] }, ranking: { teams: [] }, results: { rounds: [] } };
  }
}

function validateMatch(match) {
  return !!(match?.homeTeam?.name && match?.awayTeam?.name);
}

function shouldPredict(match, data) {
  return validateMatch(match);
}

function analyzeHeadToHead(homeTeam, awayTeam, data) {
  return getCached(`h2h_${homeTeam}_${awayTeam}`, 'h2h', () => {
    try {
      const meetings = [];
      for (const round of data.results?.rounds || []) {
        for (const match of round.matches || []) {
          const hN = match.homeTeam?.name, aN = match.awayTeam?.name;
          if (!((hN === homeTeam && aN === awayTeam) || (hN === awayTeam && aN === homeTeam))) continue;
          if (!match.goals?.length) continue;

          const last   = match.goals[match.goals.length - 1];
          const isHome = hN === homeTeam;
          const hScore = isHome ? last.homeScore : last.awayScore;
          const aScore = isHome ? last.awayScore : last.homeScore;
          meetings.push({ hScore, aScore, score: `${last.homeScore}-${last.awayScore}` });
        }
      }

      if (meetings.length === 0) return null;

      let homeWins = 0, draws = 0, awayWins = 0, totalGoalsW = 0, sumW = 0;
      const scoreFreq = new Map();

      meetings.forEach((m, i) => {
        const age = meetings.length - 1 - i;
        const w   = Math.exp(-0.15 * age);

        sumW       += w;
        totalGoalsW += w * (m.hScore + m.aScore);
        if      (m.hScore > m.aScore) homeWins += w;
        else if (m.hScore < m.aScore) awayWins += w;
        else                          draws    += w;

        scoreFreq.set(m.score, (scoreFreq.get(m.score) || 0) + 1);
      });

      const total = homeWins + draws + awayWins;
      if (total === 0) return null;

      const commonScores = Array.from(scoreFreq.entries())
        .map(([score, count]) => ({ score, frequency: count / meetings.length }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 5);

      return {
        home: homeWins / total,
        draw: draws    / total,
        away: awayWins / total,
        avgGoals:     totalGoalsW / sumW,
        confidence:   Math.min(0.35, meetings.length * 0.07),
        matchesCount: meetings.length,
        commonScores
      };
    } catch (err) {
      logger.error('Erreur analyzeHeadToHead:', err);
      return null;
    }
  }, config.cache.h2h * 1000);
}

function calculateWeightedForm(teamName, data) {
  try {
    const team = data.ranking?.teams?.find(t => t.name === teamName);
    if (!team) return 50;

    let formValue = 50;
    if (team.history?.length > 0) {
      const history = team.history.slice(-8);
      let sumW = 0, sumWR = 0;
      history.forEach((result, i) => {
        const age = history.length - 1 - i;
        const w   = Math.exp(-0.30 * age);
        const pts = result === 'Won' ? 100 : result === 'Draw' ? 50 : 0;
        sumW  += w;
        sumWR += w * pts;
      });
      formValue = sumW > 0 ? sumWR / sumW : 50;
    }

    formValue += (20 - team.position) * 0.8;

    return clamp(Math.round(formValue), 20, 95);
  } catch (err) {
    logger.error('Erreur calculateWeightedForm:', err);
    return 50;
  }
}

function calculateLightweightFeatures(homeTeam, awayTeam, data) {
  return getCached(`features_${homeTeam}_${awayTeam}`, 'intermediate', () => {
    const home = data.ranking?.teams?.find(t => t.name === homeTeam);
    const away = data.ranking?.teams?.find(t => t.name === awayTeam);
    if (!home || !away) return { rankAdvantage: 0, formAdvantage: 0, homeMomentum: 0 };

    const rankAdv = clamp((away.position - home.position) * 0.01, -0.15, 0.15);

    const hLast3  = home.history?.slice(-3) || [];
    const aLast3  = away.history?.slice(-3) || [];
    const hForm3  = hLast3.length > 0 ? hLast3.filter(r => r === 'Won').length / 3 : 0.5;
    const aForm3  = aLast3.length > 0 ? aLast3.filter(r => r === 'Won').length / 3 : 0.5;
    const formAdv = clamp((hForm3 - aForm3) * 0.2, -0.1, 0.1);

    const homeMomentum = hLast3[2] === 'Won' ? 0.03 : hLast3[2] === 'Lost' ? -0.02 : 0;

    return { rankAdvantage: rankAdv, formAdvantage: formAdv, homeMomentum };
  }, 90_000);
}

function extractOdds(match) {
  const odds = { '1x2': { home: null, draw: null, away: null }, ht_1x2: { home: null, draw: null, away: null } };
  try {
    for (const betType of match.eventBetTypes || []) {
      const name  = betType.name || '';
      const items = betType.eventBetTypeItems || [];
      const target = name === '1X2' ? odds['1x2'] : name === 'Mi-tps 1X2' ? odds.ht_1x2 : null;
      if (!target) continue;
      for (const item of items) {
        const o = parseFloat(item.odds) || 0;
        if      (item.shortName === '1') target.home = o;
        else if (item.shortName === 'X') target.draw = o;
        else if (item.shortName === '2') target.away = o;
      }
    }
  } catch {}
  return odds;
}

function oddsToProbability(odds) {
  if (!odds.home || !odds.draw || !odds.away) return { home: 0.33, draw: 0.34, away: 0.33 };
  try {
    const margin = (1 / odds.home + 1 / odds.draw + 1 / odds.away) - 1;
    return normalizeTrio({
      home: (1 / odds.home) / (1 + margin),
      draw: (1 / odds.draw) / (1 + margin),
      away: (1 / odds.away) / (1 + margin)
    });
  } catch {
    return { home: 0.33, draw: 0.34, away: 0.33 };
  }
}

function predictResultFromOdds(oddsDict) {
  try {
    if (!oddsDict.home || !oddsDict.draw || !oddsDict.away) return ['X', 0];
    const p  = oddsToProbability(oddsDict);
    const max = Math.max(p.home, p.draw, p.away);
    const res = p.home === max ? '1' : p.away === max ? '2' : 'X';
    return [res, max];
  } catch {
    return ['X', 0];
  }
}

function ensembleWithVariance(eloPred, poissonPred, marketPred, h2hPred, weights, reliability) {
  try {
    const w = weights   || { elo: 0.25, poisson: 0.25, market: 0.25, h2h: 0.1 };
    const r = reliability || { elo: 0.8, poisson: 0.8, market: 0.7, h2h: 0.7 };

    const homeVals = [eloPred?.home || 0.33, poissonPred?.home || 0.33, marketPred?.home || 0.33];
    if (h2hPred) homeVals.push(h2hPred.home);
    const mean     = homeVals.reduce((a, b) => a + b, 0) / homeVals.length;
    const variance = homeVals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / homeVals.length;
    const confidencePenalty = Math.min(0.2, variance * 2);

    let totalR = (r.elo || 0.8) + (r.poisson || 0.8) + (r.market || 0.7);
    if (h2hPred) totalR += (r.h2h || 0.7);

    const calc = (key) => {
      let v = ((w.elo     || 0.25) * (eloPred?.[key]    || 0.33) * (r.elo    || 0.8) +
               (w.poisson || 0.25) * (poissonPred?.[key] || 0.33) * (r.poisson|| 0.8) +
               (w.market  || 0.25) * (marketPred?.[key]  || 0.33) * (r.market || 0.7)) / totalR;
      if (h2hPred) v += ((w.h2h || 0.1) * (h2hPred[key] || 0.33) * (r.h2h || 0.7)) / totalR;
      return v;
    };

    return {
      ...normalizeTrio({ home: calc('home'), draw: calc('draw'), away: calc('away') }),
      expectedGoals:    poissonPred?.expectedGoals || 2.5,
      mostLikelyScore:  poissonPred?.mostLikelyScore || '1:1',
      variance,
      confidencePenalty
    };
  } catch {
    return { ...FALLBACK_PREDICTION, variance: 0, confidencePenalty: 0 };
  }
}

function calculateSurpriseFactor(homeForm, awayForm, context = {}) {
  let f = 1.0;
  const diff = Math.abs(homeForm - awayForm);
  if (diff > 25) f *= (awayForm > homeForm) ? 1.10 : 0.92;
  if (context.derby)   f *= 1.08;
  if (context.revenge) f *= 1.05;
  return Math.min(1.10, Math.max(0.85, f));
}

function predictGoals(rawExpectedGoals, homeForm, awayForm, poissonPred, learningSystem, context, homeTeam, awayTeam) {
  try {
    const raw  = safeNum(rawExpectedGoals, 2.5) > 0 ? safeNum(rawExpectedGoals, 2.5) : 2.5;
    const hFrm = clamp(safeNum(homeForm, 50), 0, 100);
    const aFrm = clamp(safeNum(awayForm, 50), 0, 100);
    const lH   = safeNum(poissonPred?.lambdaHome, 1.5);
    const lA   = safeNum(poissonPred?.lambdaAway, 1.0);
    const ctx  = context || {};

    let reductionFactor = 0.75;
    for (const cat of config.scorePrediction.goalCategories) {
      if (raw <= cat.max) { reductionFactor = cat.reduction; break; }
    }

    let goals = Math.round(raw * reductionFactor);
    if (!isFinite(goals) || goals < 0) goals = 2;

    const baseGoals = goals;

    const surpriseFactor = calculateSurpriseFactor(hFrm, aFrm, ctx);
    goals = Math.round(goals * surpriseFactor);

    let adjustment = 0;
    if (hFrm > config.scorePrediction.formBoostThreshold && aFrm > config.scorePrediction.formBoostThreshold) {
      adjustment++;
    }
    if (Math.abs(hFrm - aFrm) > config.scorePrediction.formDiffThreshold) {
      adjustment--;
    }
    if ((lH / 1.5) > config.scorePrediction.attackThreshold && (lA / 1.5) > config.scorePrediction.attackThreshold) {
      adjustment++;
    }
    adjustment = clamp(adjustment, -2, 2);
    goals = clamp(goals + adjustment, CONSTANTS.MIN_GOALS_PREDICTION, CONSTANTS.MAX_GOALS_PREDICTION);

    try {
      const gl = learningSystem?.getGoalLearning?.();
      if (gl) {
        const adjusted = gl.predictGoals(raw, homeTeam, awayTeam, ctx);
        if (isFinite(adjusted)) goals = Math.round((goals + adjusted) / 2);
      }
    } catch (e) {
      logger.debug('goalLearning non-bloquant:', e.message);
    }

    try {
      const cal = learningSystem?.getScoreCalibrator?.();
      if (cal) {
        const bias = cal.getContextualBias(ctx);
        if (isFinite(bias)) goals = Math.round(goals - bias);
        goals = cal.adjustPrediction(goals);
      }
    } catch (e) {
      logger.debug('scoreCalibrator non-bloquant:', e.message);
    }

    goals = clamp(Math.round(goals || 2), CONSTANTS.MIN_GOALS_PREDICTION, CONSTANTS.MAX_GOALS_PREDICTION);

    logger.debug(`Goals: raw=${raw.toFixed(2)} reduc=${reductionFactor} surp=${surpriseFactor.toFixed(2)} final=${goals}`);

    return { goals, reductionFactor, rawExpected: raw, surpriseFactor };
  } catch (err) {
    logger.error('Erreur fatale predictGoals, fallback:', err);
    return { goals: 2, reductionFactor: 0.75, rawExpected: 2.5, surpriseFactor: 1.0 };
  }
}

async function predictExactScore(poissonPred, h2hPred, homeTeam, awayTeam, homeForm, awayForm, learningSystem) {
  const predictor = learningSystem.getAdvancedScorePredictor();
  const calibrator = learningSystem.getScoreCalibrator();

  let probs = predictor.predictExactScore(poissonPred, h2hPred, homeTeam, awayTeam, homeForm, awayForm);
  probs = calibrator.calibrateScoreProbability(probs, 70);

  return {
    topScore:       probs[0]?.score || '1:1',
    topProbability: probs[0]?.probability || 0,
    top5:           probs.slice(0, 5).map(s => ({ score: s.score, prob: s.probability })),
    full:           probs
  };
}

function computeConfidence(finalProb, finalResult, homeForm, awayForm, ensemble) {
  const resultKey = finalResult === '1' ? 'home' : finalResult === '2' ? 'away' : 'draw';
  let conf = safeNum(finalProb[resultKey], 0.5) * 100;

  if (!isFinite(conf) || conf < 0 || conf > 100) conf = 50;

  if (finalResult === '1' && homeForm > awayForm + config.vfl.confidenceBoostThreshold) conf += 10;
  if (finalResult === '2' && awayForm > homeForm + config.vfl.confidenceBoostThreshold) conf += 10;
  if (finalResult === '2' && awayForm < config.vfl.confidencePenaltyThreshold)           conf = Math.round(conf * 0.85);

  const penalty = Math.round(safeNum(ensemble?.confidencePenalty, 0) * 100);
  if (penalty > 0) conf -= penalty;

  return clamp(Math.round(isFinite(conf) ? conf : 50), CONSTANTS.MIN_CONFIDENCE, CONSTANTS.MAX_CONFIDENCE);
}

// ─── PRÉDICTION PRINCIPALE ────────────────────────────────────────────────────
async function predictMatch(match, data) {
  const startTime = Date.now();
  if (!match || !data) {
    logger.warn('predictMatch: paramètres invalides');
    return null;
  }
  try {
    if (!validateMatch(match)) return null;

    const homeTeam = match.homeTeam.name;
    const awayTeam = match.awayTeam.name;

    const [learningSystem, eloSystem, poissonModel, thresholds, biasCorrector, contextDetector] =
      await Promise.all([
        systems.learning.get(),
        systems.elo.get(),
        systems.poisson.get(),
        systems.thresholds.get(),
        systems.biasCorrector.get(),
        systems.contextDetector.get()
      ]);

    const oddsData  = extractOdds(match);
    const [htResult] = predictResultFromOdds(oddsData.ht_1x2);

    const eloPred    = eloSystem.predict(homeTeam, awayTeam);
    const poissonPred= poissonModel.predict(homeTeam, awayTeam, biasCorrector, learningSystem);
    const marketPred    = oddsToProbability(oddsData['1x2']);
    const marketHasOdds = !!(oddsData['1x2']?.home && oddsData['1x2']?.draw && oddsData['1x2']?.away);
    const h2hPred    = analyzeHeadToHead(homeTeam, awayTeam, data);
    const context    = contextDetector.detectContext(homeTeam, awayTeam, data);

    let weights = learningSystem.getWeights(context);
    if (!marketHasOdds) {
      const freed = weights.market;
      weights = {
        elo:     weights.elo     + freed * 0.55,
        poisson: weights.poisson + freed * 0.35,
        market:  0,
        h2h:     weights.h2h    + freed * 0.10
      };
    }
    const reliability= learningSystem.getModelReliability();
    const features   = calculateLightweightFeatures(homeTeam, awayTeam, data);

    let ensemble = ensembleWithVariance(eloPred, poissonPred, marketPred, h2hPred, weights, reliability);
    ensemble     = biasCorrector.correct(ensemble);

    const homeForm = calculateWeightedForm(homeTeam, data);
    const awayForm = calculateWeightedForm(awayTeam, data);

    const homeAdv  = learningSystem.getHomeAdvantage(homeTeam);

    const rawFeatureBoost = features.rankAdvantage + features.formAdvantage + features.homeMomentum;
    const raw = {
      home: ensemble.home + homeAdv + rawFeatureBoost,
      draw: ensemble.draw,
      away: ensemble.away
    };
    const finalProb = normalizeTrio(raw);

    const DRAW_THRESHOLD  = 0.20;
    const GAP_THRESHOLD   = 0.10;
    const homeAwayGap     = Math.abs(finalProb.home - finalProb.away);
    const forceDrawRaw    = finalProb.draw >= DRAW_THRESHOLD && homeAwayGap < GAP_THRESHOLD;

    const drawH2HBonus    = h2hPred && h2hPred.draw > 0.25;
    const forceDraw       = forceDrawRaw ||
      (drawH2HBonus && finalProb.draw >= 0.17 && homeAwayGap < 0.15);

    const finalResult = forceDraw                                                   ? 'X'
                      : finalProb.home > finalProb.draw && finalProb.home > finalProb.away ? '1'
                      : finalProb.away > finalProb.home && finalProb.away > finalProb.draw ? '2'
                      : 'X';

    const safeExpected = safeNum(ensemble.expectedGoals, 2.5) > 0 ? safeNum(ensemble.expectedGoals, 2.5) : 2.5;
    const goalPrediction = predictGoals(safeExpected, homeForm, awayForm, poissonPred, learningSystem, context, homeTeam, awayTeam);
    const goals          = goalPrediction.goals;

    const scorePrediction = await predictExactScore(poissonPred, h2hPred, homeTeam, awayTeam, homeForm, awayForm, learningSystem);

    const GOALS_TOLERANCE = 1;

    const coherentScores = scorePrediction.top5.filter(s => {
      const [h, a] = s.score.split(':').map(Number);
      const totalOk  = Math.abs((h + a) - goals) <= GOALS_TOLERANCE;
      const resultOk = finalResult === '1' ? h > a
                     : finalResult === '2' ? a > h
                     : h === a;
      return totalOk && resultOk;
    });

    if (coherentScores.length === 0) {
      let fallbackScore;
      if (finalResult === 'X') {
        const half = Math.floor(goals / 2);
        fallbackScore = `${half}:${half}`;
      } else {
        const big   = Math.ceil(goals * 0.6);
        const small = goals - big >= 0 ? goals - big : 0;
        fallbackScore = finalResult === '1' ? `${big}:${small}` : `${small}:${big}`;
      }
      coherentScores.push({ score: fallbackScore, prob: 0 });
    }

    scorePrediction.top5      = coherentScores;
    scorePrediction.topScore  = coherentScores[0].score;
    scorePrediction.topProbability = coherentScores[0].prob || 0;

    const thresholdData = thresholds.get();
    let confidence      = computeConfidence(finalProb, finalResult, homeForm, awayForm, ensemble);
    if (confidence < thresholdData.confidence) confidence = Math.round(confidence * 0.95);

    confidence = learningSystem.getCalibratedConfidence(confidence);

    confidence += learningSystem.getHTConfidenceAdjustment(htResult, finalResult);

    const uncertainty = learningSystem.computeUncertaintyScore(
      finalProb,
      h2hPred?.matchesCount || 0,
      ensemble.variance || 0
    );
    if (uncertainty > 0.6) {
      confidence = Math.round(confidence * (1 - (uncertainty - 0.6) * 0.5));
      logger.debug(`Match incertain (${Math.round(uncertainty*100)}%) → confiance réduite`);
    }

    confidence = clamp(confidence, CONSTANTS.MIN_CONFIDENCE, CONSTANTS.MAX_CONFIDENCE);

    const modelContributions = {
      elo:     safeNum((weights.elo     || 0) * (finalResult === '1' ? eloPred.home     : finalResult === '2' ? eloPred.away     : eloPred.draw)),
      poisson: safeNum((weights.poisson || 0) * (finalResult === '1' ? poissonPred.home : finalResult === '2' ? poissonPred.away : poissonPred.draw)),
      market:  safeNum((weights.market  || 0) * (finalResult === '1' ? marketPred.home  : finalResult === '2' ? marketPred.away  : marketPred.draw)),
      h2h:     h2hPred ? safeNum((weights.h2h || 0) * (finalResult === '1' ? h2hPred.home : finalResult === '2' ? h2hPred.away : h2hPred.draw)) : 0
    };

    const safeHomeForm = clamp(Math.round(safeNum(homeForm, 50)), 5, 95);
    const safeAwayForm = clamp(Math.round(safeNum(awayForm, 50)), 5, 95);
    const safeGoals    = clamp(safeNum(goals, 2), 1, 10);
    const oddsStr = (o) => o?.home && o?.draw && o?.away
      ? `${o.home.toFixed(2)}/${o.draw.toFixed(2)}/${o.away.toFixed(2)}`
      : '-/-/-';

    setImmediate(async () => {
      try {
        await Prediction.create({
          match:        `${homeTeam} vs ${awayTeam}`,
          home_team:    homeTeam,
          away_team:    awayTeam,
          prediction:   finalResult,
          confidence,
          goals:        safeGoals,
          exact_score:  scorePrediction.topScore || '0:0',
          half_time:    htResult || 'X',
          odds_1x2:     oddsStr(oddsData['1x2']),
          odds_ht:      oddsStr(oddsData.ht_1x2),
          home_form:    safeHomeForm,
          away_form:    safeAwayForm,
          model_snapshot: {
            weights,
            modelContributions,
            eloRatings:      { home: eloPred.homeRating || 1600, away: eloPred.awayRating || 1600 },
            scoreProbabilities: scorePrediction.top5 || [],
            goalPrediction:  { rawExpected: goalPrediction.rawExpected, reductionFactor: goalPrediction.reductionFactor }
          },
          match_date: new Date()
        });
      } catch (err) {
        logger.error('Erreur sauvegarde prédiction:', err);
      }
    });

    safeMetric(() => metrics.predictionLatency.observe((Date.now() - startTime) / 1000));

    return {
      match:                  `${homeTeam} vs ${awayTeam}`,
      prediction:             finalResult,
      confidence,
      goals:                  safeGoals,
      exact_score:            scorePrediction.topScore,
      exact_score_probability:scorePrediction.topProbability,
      top_scores:             scorePrediction.top5,
      half_time:              htResult || 'X',
      odds_1x2:               oddsStr(oddsData['1x2']),
      odds_ht:                oddsStr(oddsData.ht_1x2),
      home_form:              safeHomeForm,
      away_form:              safeAwayForm,
      uncertainty:            Math.round(uncertainty * 100),
      home_style:             learningSystem.getTeamStyle(homeTeam),
      away_style:             learningSystem.getTeamStyle(awayTeam)
    };
  } catch (err) {
    logger.error('Erreur fatale dans predictMatch:', err);
    return null;
  }
}

// ─── MISE À JOUR DES MODÈLES ──────────────────────────────────────────────────
const _processedMatches = new Set();
let   _processedClearedAt = Date.now();

function isMatchProcessed(id) {
  if (Date.now() - _processedClearedAt > 3_600_000) {
    _processedMatches.clear();
    _processedClearedAt = Date.now();
  }
  return _processedMatches.has(id);
}

async function updateModelsFromResults(data) {
  if (!data.results?.rounds) return;

  const BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
  const CAT  = 'eventCategoryId=135402';
  const PID  = 'parentEventCategoryId=8035';

  try {
    const [learningSystem, eloSystem, poissonModel, biasCorrector, thresholds, contextDetector] =
      await Promise.all([
        systems.learning.get(), systems.elo.get(), systems.poisson.get(),
        systems.biasCorrector.get(), systems.thresholds.get(), systems.contextDetector.get()
      ]);

    for (const round of data.results.rounds) {
      const roundNumber = round.roundNumber;
      if (!roundNumber) continue;

      const roundKey = `round_data_${roundNumber}`;
      let   roundMatches = caches.learning.get(roundKey);

      if (!roundMatches) {
        try {
          const roundData = await fetchWithRetry(
            `${BASE}/round/${roundNumber}?${CAT}&getNext=false`,
            `round_${roundNumber}`
          );
          roundMatches = roundData?.round?.matches || [];
          if (roundMatches.length > 0) caches.learning.set(roundKey, roundMatches);
        } catch (e) {
          logger.debug(`Impossible de charger /round/${roundNumber}:`, e.message);
          continue;
        }
      }

      if (!roundMatches || !roundMatches.length) continue;

      const playoutKey = `playout_${roundNumber}`;
      let   playoutById = caches.learning.get(playoutKey);

      if (!playoutById) {
        try {
          const playoutData = await fetchWithRetry(
            `${BASE}/round/${roundNumber}/playout?${CAT}&${PID}`,
            `playout_${roundNumber}`
          );
          const pms = playoutData?.matches || [];
          playoutById = {};
          for (const pm of pms) {
            if (pm.id) playoutById[pm.id] = pm;
          }
          if (Object.keys(playoutById).length > 0) caches.learning.set(playoutKey, playoutById);
        } catch (e) {
          logger.debug(`Impossible de charger /playout/${roundNumber}:`, e.message);
          playoutById = {};
        }
      }

      for (const match of roundMatches) {
        const matchId = match.id;
        if (!matchId || isMatchProcessed(matchId)) continue;

        const homeTeam = match.homeTeam?.name;
        const awayTeam = match.awayTeam?.name;
        if (!homeTeam || !awayTeam) continue;

        const playout = playoutById?.[matchId];
        if (!playout?.goals?.length) continue;

        const goals   = playout.goals;
        const last    = goals[goals.length - 1];
        const hG      = Math.round(last.homeScore);
        const aG      = Math.round(last.awayScore);
        const result  = hG > aG ? '1' : hG === aG ? 'X' : '2';
        const resVal  = hG > aG ? 1   : hG === aG ? 0.5  : 0;
        const actualScore = `${hG}:${aG}`;

        const htGoals  = goals.filter(g => (g.minute || 90) <= 45);
        const htLast   = htGoals.length ? htGoals[htGoals.length - 1] : null;
        const actualHT = htLast
          ? (htLast.homeScore > htLast.awayScore ? '1'
          : htLast.homeScore < htLast.awayScore  ? '2' : 'X')
          : 'X';

        const context = contextDetector.detectContext(homeTeam, awayTeam, data);
        learningSystem.updateScoreDistribution(hG, aG);

        TemporalFeatureExtractor.recordHalfTimeStats(homeTeam, awayTeam, goals);

        const predictions = await Prediction.findAll({
          where: { home_team: homeTeam, away_team: awayTeam, actual_result: null }
        });

        await Promise.all(predictions.map(async (pred) => {
          await pred.update({ actual_result: result, actual_score: actualScore });
          await learningSystem.recordPrediction(
            { match: pred.match, final_result: pred.prediction, goals: pred.goals,
              exact_score: pred.exact_score, confidence: pred.confidence,
              half_time: pred.half_time, id: pred.id },
            result,
            pred.model_snapshot?.modelContributions || {},
            hG + aG, actualScore, context, actualHT
          );
          thresholds.update({ prediction: pred.prediction, confidence: pred.confidence }, result);
          biasCorrector.update(pred.prediction, result);
        }));

        await eloSystem.updateFromResult(homeTeam, awayTeam, resVal, hG, aG);
        await poissonModel.updateFromResult(homeTeam, awayTeam, hG, aG);
        _processedMatches.add(matchId);
      }
    }
  } catch (err) {
    logger.error('Erreur updateModelsFromResults:', err);
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  async getPredictions() {
    const startTotal = Date.now();
    try {
      const PRED_CACHE_KEY = 'predictions_current_round';
      const cachedPreds    = caches.api.get(PRED_CACHE_KEY);
      if (cachedPreds) return cachedPreds;

      const data = await fetchData();

      const prevRound = caches.api.get('last_predicted_round');
      if (prevRound && prevRound !== data.currentRound) {
        logger.info(`🔄 Nouveau round détecté: ${prevRound} → ${data.currentRound}`);
        caches.api.del(PRED_CACHE_KEY);
        setImmediate(() =>
          updateModelsFromResults(data)
            .then(() => caches.api.set('last_models_update', Date.now()))
            .catch(e => logger.error('Erreur update round change:', e))
        );
      }
      caches.api.set('last_predicted_round', data.currentRound);

      const lastUpdate = caches.api.get('last_models_update') || 0;
      const now        = Date.now();
      if (now - lastUpdate > 60_000) {
        setImmediate(() =>
          updateModelsFromResults(data)
            .then(() => caches.api.set('last_models_update', Date.now()))
            .catch(e => logger.error('Erreur background update:', e))
        );
      }

      const nextMatches = data.matches?.rounds?.flatMap(r => r.matches || []) || [];
      if (nextMatches.length === 0) {
        logger.warn('Aucun match trouvé');
        return [];
      }

      const predictions = await Promise.all(
        nextMatches
          .filter(m => shouldPredict(m, data))
          .slice(0, 10)
          .map(m => predictMatch(m, data))
      );

      const valid    = predictions.filter(Boolean);
      const duration = Date.now() - startTotal;

      if (valid.length > 0) caches.api.set(PRED_CACHE_KEY, valid, 12);

      try {
        const biasCorrector  = await systems.biasCorrector.get();
        const learningSystem = await systems.learning.get();
        const biasStats      = biasCorrector.getStats();
        const lStats         = learningSystem.getLearningStats();

        logger.info(`✅ ${valid.length} prédictions VFL en ${duration}ms`, {
          accuracy: Math.round((biasStats?.homeWinRate  || 0) * 100) + '%',
          draw:     Math.round((biasStats?.drawRate     || 0) * 100) + '%',
          goalAcc:  Math.round((lStats.scoreMetrics?.overall?.goalsExact  || 0) * 100) + '%',
          within1:  Math.round((lStats.scoreMetrics?.overall?.goalsWithin1|| 0) * 100) + '%',
          bias:     Math.round((lStats.scoreMetrics?.overall?.goalsBias   || 0) * 10) / 10,
          samples:  biasStats?.sampleSize || 0
        });
      } catch (e) {
        logger.debug('Erreur stats log:', e.message);
      }

      return valid;
    } catch (err) {
      logger.error('Erreur globale getPredictions:', err);
      return [];
    }
  },

  async getMetrics(req, res) {
    try {
      res.set('Content-Type', promClient.register.contentType);
      res.end(await promClient.register.metrics());
    } catch (err) {
      logger.error('Erreur getMetrics:', err);
      res.status(500).send('Erreur métriques');
    }
  },

  async getLearningStats() {
    try {
      const s = await systems.learning.get();
      return s.getLearningStats();
    } catch (err) {
      logger.error('Erreur getLearningStats:', err);
      return { accuracy: 0, totalPredictions: 0, modelAccuracy: {}, homeAdvantage: 0.18, weights: {} };
    }
  },

  async getVFLStats() {
    try {
      const [biasCorrector, thresholds, learningSystem] = await Promise.all([
        systems.biasCorrector.get(),
        systems.thresholds.get(),
        systems.learning.get()
      ]);
      const stats = learningSystem.getLearningStats();

      return {
        biases:        biasCorrector.getStats(),
        thresholds:    thresholds.get(),
        modelVariance: learningSystem.modelVariance,
        scoreStats:    stats.scoreMetrics,
        goalStats: {
          exactAccuracy:  stats.scoreMetrics?.overall?.goalsExact   || 0,
          withinOneAccuracy: stats.scoreMetrics?.overall?.goalsWithin1 || 0,
          bias:           stats.scoreMetrics?.overall?.goalsBias    || 0,
          byConfidence:   stats.scoreMetrics?.byConfidence          || {}
        }
      };
    } catch (err) {
      logger.error('Erreur getVFLStats:', err);
      return { biases: {}, thresholds: {}, modelVariance: {}, scoreStats: {}, goalStats: {} };
    }
  }
};