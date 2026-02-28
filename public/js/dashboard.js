// Configuration
const API_KEY = 'PremiumAnalyse60';
const API_URL = '/api/predictions/stats';
let statsData = null;

// Éléments DOM
const lastUpdateEl = document.getElementById('lastUpdate');
const refreshBtn = document.getElementById('refreshBtn');

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    setInterval(loadStats, 30000); // Rafraîchir toutes les 30 secondes
});

refreshBtn.addEventListener('click', () => {
    refreshBtn.style.transform = 'rotate(360deg)';
    setTimeout(() => {
        refreshBtn.style.transform = '';
    }, 500);
    loadStats();
});

// Chargement des stats
async function loadStats() {
    try {
        const response = await fetch(API_URL, {
            headers: { 'X-API-Key': API_KEY }
        });
        const data = await response.json();
        
        if (data.success) {
            statsData = data.stats;
            updateDashboard(data.stats);
            updateLastUpdate();
        }
    } catch (error) {
        console.error('Erreur chargement stats:', error);
        showError();
    }
}

// Mise à jour de l'UI
function updateDashboard(stats) {
    // KPIs principaux
    document.getElementById('accuracyValue').textContent = 
        `${(stats.accuracy * 100).toFixed(1)}%`;
    document.getElementById('totalPredictions').textContent = 
        stats.totalPredictions;
    document.getElementById('exactMatchValue').textContent = 
        `${(stats.scoreMetrics?.overall?.exactMatch * 100 || 0).toFixed(1)}%`;
    document.getElementById('withinOneValue').textContent = 
        `${(stats.scoreMetrics?.overall?.withinOneGoal * 100 || 0).toFixed(1)}%`;
    document.getElementById('goalsExactValue').textContent = 
        `${(stats.scoreMetrics?.overall?.goalsExact * 100 || 0).toFixed(1)}%`;
    document.getElementById('goalsWithinValue').textContent = 
        `${(stats.scoreMetrics?.overall?.goalsWithin1 * 100 || 0).toFixed(1)}%`;
    document.getElementById('goalsBias').textContent = 
        stats.scoreMetrics?.overall?.goalsBias?.toFixed(2) || '0';
    document.getElementById('sampleSize').textContent = 
        stats.scoreMetrics?.overall?.totalPredictions || stats.totalPredictions;
    document.getElementById('homeAdvantage').textContent = 
        `${(stats.homeAdvantage * 100).toFixed(1)}%`;

    // Poids des modèles
    updateWeights(stats.weights);
    
    // Distribution des buts
    updateGoalRange(stats.goalRangeDistribution);
    
    // Scores fréquents
    updateCommonScores(stats.commonScores);
    
    // Calibration
    updateCalibration(stats.calibration, stats.scoreMetrics?.byConfidence);
    
    // Insights
    generateInsights(stats);
}

function updateWeights(weights) {
    const container = document.getElementById('weightsContainer');
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    
    let html = '';
    for (const [model, weight] of Object.entries(weights)) {
        const percent = (weight / total * 100).toFixed(1);
        const color = getModelColor(model);
        html += `
            <div class="progress-wrapper">
                <div class="progress-label">
                    <span><i class="fas fa-${getModelIcon(model)}"></i> ${model.toUpperCase()}</span>
                    <span class="fw-bold">${percent}%</span>
                </div>
                <div class="progress">
                    <div class="progress-bar ${color}" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

function getModelColor(model) {
    const colors = {
        elo: 'bg-success',
        poisson: 'bg-info',
        market: 'bg-warning',
        h2h: 'bg-danger'
    };
    return colors[model] || 'bg-primary';
}

function getModelIcon(model) {
    const icons = {
        elo: 'chart-line',
        poisson: 'chart-bar',
        market: 'store',
        h2h: 'handshake'
    };
    return icons[model] || 'cube';
}

function updateGoalRange(distribution) {
    const chart = document.getElementById('goalRangeChart');
    const ranges = [
        { label: '0-1 buts', value: distribution.low || 0, color: 'bg-success' },
        { label: '2-3 buts', value: distribution.medium || 0, color: 'bg-warning' },
        { label: '4+ buts', value: distribution.high || 0, color: 'bg-danger' }
    ];
    
    let html = '';
    ranges.forEach((range, index) => {
        const percent = (range.value * 100).toFixed(1);
        const height = Math.max(30, percent * 1.5); // Hauteur proportionnelle
        html += `
            <div class="chart-bar" style="height: ${height}px;">
                <span>${range.label}<br>${percent}%</span>
            </div>
        `;
    });
    chart.innerHTML = html;
}

function updateCommonScores(scores) {
    const container = document.getElementById('commonScores');
    if (!scores || scores.length === 0) {
        container.innerHTML = '<p class="text-muted">Aucun score disponible</p>';
        return;
    }
    
    let html = '';
    scores.slice(0, 8).forEach(score => {
        const percent = (score.frequency * 100).toFixed(1);
        html += `
            <div class="score-item">
                <div class="score">${score.score}</div>
                <div class="frequency">${percent}%</div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function updateCalibration(calibration, byConfidence) {
    const tbody = document.getElementById('calibrationTable');
    const insight = document.getElementById('calibrationInsight');
    
    if (!calibration) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Aucune donnée</td></tr>';
        return;
    }
    
    let html = '';
    let problemLevels = [];
    
    Object.entries(calibration)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .forEach(([level, data]) => {
            const confData = byConfidence?.[level] || {};
            const expectedAccuracy = parseInt(level) / 100;
            const actualAccuracy = data.accuracy || 0;
            const diff = actualAccuracy - expectedAccuracy;
            
            let status = '';
            let statusClass = '';
            
            if (Math.abs(diff) < 0.1) {
                status = '✓ Bien calibré';
                statusClass = 'text-success';
            } else if (diff > 0.1) {
                status = '⬆️ Sous-estimé';
                statusClass = 'text-warning';
                problemLevels.push(level);
            } else {
                status = '⬇️ Surestimé';
                statusClass = 'text-danger';
                problemLevels.push(level);
            }
            
            html += `
                <tr>
                    <td><span class="badge bg-primary">${level}%</span></td>
                    <td>${(data.accuracy * 100).toFixed(1)}%</td>
                    <td>${(data.exactRate * 100 || 0).toFixed(1)}%</td>
                    <td>${(confData.goalsExactAccuracy * 100 || 0).toFixed(1)}%</td>
                    <td>${data.sampleSize || 0}</td>
                    <td class="${statusClass}">${status}</td>
                </tr>
            `;
        });
    
    tbody.innerHTML = html;
    
    // Insight sur la calibration
    if (problemLevels.length > 0) {
        insight.innerHTML = `
            <i class="fas fa-exclamation-triangle text-warning me-2"></i>
            <strong>Attention :</strong> Les niveaux de confiance ${problemLevels.join('%, ')}% 
            ne sont pas bien calibrés. Les prédictions à ${problemLevels[0]}% de confiance 
            ont une précision réelle de ${(calibration[problemLevels[0]]?.accuracy * 100 || 0).toFixed(1)}%.
        `;
    } else {
        insight.innerHTML = `
            <i class="fas fa-check-circle text-success me-2"></i>
            <strong>Excellent :</strong> La calibration est bonne sur tous les niveaux de confiance !
        `;
    }
}

function generateInsights(stats) {
    const container = document.getElementById('insights');
    const insights = [];
    
    // Insight 1: Précision globale
    if (stats.accuracy > 0.7) {
        insights.push({
            icon: '🎯',
            title: 'Excellente précision',
            text: `Le modèle prédit correctement ${(stats.accuracy * 100).toFixed(1)}% des vainqueurs.`
        });
    }
    
    // Insight 2: Biais de buts
    const bias = stats.scoreMetrics?.overall?.goalsBias || 0;
    if (Math.abs(bias) > 0.5) {
        insights.push({
            icon: '⚽',
            title: 'Biais de buts détecté',
            text: `Le modèle ${bias > 0 ? 'surestime' : 'sous-estime'} les buts de ${Math.abs(bias).toFixed(2)} en moyenne.`,
            severity: 'warning'
        });
    }
    
    // Insight 3: Modèle dominant
    const topModel = Object.entries(stats.weights).sort((a, b) => b[1] - a[1])[0];
    insights.push({
        icon: '🏆',
        title: 'Modèle dominant',
        text: `Le modèle ${topModel[0].toUpperCase()} est le plus utilisé (${(topModel[1] * 100).toFixed(1)}% du poids).`
    });
    
    // Insight 4: Score le plus fréquent
    if (stats.commonScores && stats.commonScores[0]) {
        insights.push({
            icon: '📊',
            title: 'Score typique',
            text: `Le score ${stats.commonScores[0].score} apparaît dans ${(stats.commonScores[0].frequency * 100).toFixed(1)}% des matches.`
        });
    }
    
    // Insight 5: Évolution
    if (stats.scoreMetrics?.recentAccuracy > stats.accuracy) {
        insights.push({
            icon: '📈',
            title: 'Tendance positive',
            text: `La précision récente (${(stats.scoreMetrics.recentAccuracy * 100).toFixed(1)}%) est supérieure à la moyenne globale.`
        });
    }
    
    // Génération du HTML
    let html = '<div class="row g-3">';
    insights.forEach(insight => {
        html += `
            <div class="col-md-6">
                <div class="alert-insight" style="background: rgba(0,126,58,0.05);">
                    <div class="d-flex align-items-start gap-3">
                        <span style="font-size: 2rem;">${insight.icon}</span>
                        <div>
                            <h5 class="mb-1">${insight.title}</h5>
                            <p class="mb-0">${insight.text}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    container.innerHTML = html;
}

function updateLastUpdate() {
    const now = new Date();
    lastUpdateEl.textContent = `Dernière mise à jour: ${now.toLocaleTimeString()}`;
}

function showError() {
    const containers = [
        'accuracyValue', 'exactMatchValue', 'goalsExactValue'
    ];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '⚠️';
    });
}