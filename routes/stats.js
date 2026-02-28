<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>VFL - Stats apprentissage</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-dark text-white">
    <div class="container mt-5">
        <h1 class="text-success">📊 Ce que le système a appris</h1>
        
        <div class="row mt-4" id="stats-container">
            <div class="col-12 text-center">
                <div class="spinner-border text-light"></div>
                <p class="mt-2">Chargement des stats...</p>
            </div>
        </div>
    </div>

    <script>
        async function loadStats() {
            try {
                const response = await fetch('/api/predictions/stats', {
                    headers: { 'X-API-Key': 'PremiumAnalyse60' }
                });
                const data = await response.json();
                
                if (data.success) {
                    displayStats(data.stats);
                }
            } catch (error) {
                console.error(error);
            }
        }

        function displayStats(stats) {
            const html = `
                <div class="col-md-6">
                    <div class="card bg-secondary mb-3">
                        <div class="card-header bg-success">🎯 Performance</div>
                        <div class="card-body">
                            <p>Vainqueurs corrects: <strong>${(stats.accuracy * 100).toFixed(1)}%</strong></p>
                            <p>Scores exacts: <strong>${(stats.scoreMetrics?.overall?.exactMatch * 100 || 0).toFixed(1)}%</strong></p>
                            <p>Buts exacts: <strong>${(stats.scoreMetrics?.overall?.goalsExact * 100 || 0).toFixed(1)}%</strong></p>
                            <p>À 1 but près: <strong>${(stats.scoreMetrics?.overall?.goalsWithin1 * 100 || 0).toFixed(1)}%</strong></p>
                            <p>Total prédictions: <strong>${stats.totalPredictions}</strong></p>
                        </div>
                    </div>
                </div>

                <div class="col-md-6">
                    <div class="card bg-secondary mb-3">
                        <div class="card-header bg-warning">⚖️ Poids des modèles</div>
                        <div class="card-body">
                            <p>ELO: <strong>${(stats.weights.elo * 100).toFixed(1)}%</strong></p>
                            <p>Poisson: <strong>${(stats.weights.poisson * 100).toFixed(1)}%</strong></p>
                            <p>Marché: <strong>${(stats.weights.market * 100).toFixed(1)}%</strong></p>
                            <p>Face-à-face: <strong>${(stats.weights.h2h * 100).toFixed(1)}%</strong></p>
                        </div>
                    </div>
                </div>

                <div class="col-12">
                    <div class="card bg-secondary">
                        <div class="card-header bg-info">📈 Scores les plus fréquents</div>
                        <div class="card-body">
                            <div class="row">
                                ${stats.commonScores.map(s => `
                                    <div class="col-md-2 col-4 text-center mb-2">
                                        <div class="border rounded p-2">
                                            <h3>${s.score}</h3>
                                            <small>${(s.frequency * 100).toFixed(1)}%</small>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById('stats-container').innerHTML = html;
        }

        loadStats();
        // Rafraîchir toutes les 30 secondes
        setInterval(loadStats, 30000);
    </script>
</body>
</html>