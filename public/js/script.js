// public/js/script.js

// Fonction pour afficher les erreurs
function showError(message) {
    const keyError = document.getElementById('keyError');
    keyError.textContent = message;
    keyError.classList.add('shake');
    setTimeout(() => {
        keyError.classList.remove('shake');
    }, 500);
}

// Fonction pour mettre à jour les prédictions
function updatePredictions(predictions) {
    const container = document.getElementById('predictionsList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!predictions || predictions.length === 0) {
        container.innerHTML = `
            <div class="alert alert-warning text-center">
                <i class="fas fa-exclamation-circle me-2"></i>
                Aucune prédiction disponible pour le moment
                <div class="loading-dots mt-2">
                    <span>.</span><span>.</span><span>.</span>
                </div>
            </div>
        `;
        return;
    }
    
    // Animation delay
    let delay = 0;
    
    predictions.forEach(pred => {
        const card = document.createElement('div');
        card.className = 'card mb-4 shadow prediction-card';
        card.style.animation = `slideUp 0.5s ease-out ${delay}ms forwards`;
        card.style.opacity = '0';
        
        card.innerHTML = `
            <div class="card-header">
                <h5>${pred.match}</h5>
                <div class="d-flex justify-content-between align-items-center mt-2">
                    <span class="badge bg-dark">${pred.competition}</span>
                    <span class="badge bg-secondary">${pred.date}</span>
                </div>
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Score final:</strong> <span class="badge badge-success">${pred.final_result}</span></p>
                        <p><strong>Nombre de buts:</strong> <span class="badge badge-info">${pred.goals}</span></p>
                        <p><strong>Mi-temps:</strong> <span class="badge badge-warning">${pred.half_time}</span></p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Forme domicile:</strong> ${pred.home_form}</p>
                        <p><strong>Forme extérieur:</strong> ${pred.away_form}</p>
                        <p><strong>Cotes 1X2:</strong> ${pred.odds_1x2}</p>
                        <p><strong>Cotes mi-temps:</strong> ${pred.odds_ht}</p>
                    </div>
                </div>
                <div class="mt-3 d-flex justify-content-between">
                    <span class="badge bg-primary">Confiance: ${pred.confidence}%</span>
                    <span class="badge bg-info">Historique: ${pred.history}</span>
                </div>
            </div>
        `;
        container.appendChild(card);
        delay += 100; // Augmenter le délai pour l'animation en cascade
    });
}

// Fonction pour charger les prédictions
async function loadPredictions() {
    try {
        const apiKey = localStorage.getItem('apiKey') || '';
        const response = await fetch('/api/predict', {
            headers: {
                'X-API-Key': apiKey
            }
        });
        
        if (response.status === 401) {
            throw new Error('Clé API invalide. Veuillez vérifier et réessayer.');
        }
        
        if (!response.ok) {
            throw new Error('Erreur de connexion au serveur');
        }
        
        const predictions = await response.json();
        updatePredictions(predictions);
        return predictions;
    } catch (error) {
        console.error('Erreur lors du chargement des prédictions:', error);
        // Réafficher le formulaire si l'erreur est liée à la clé
        const keyAccessCard = document.querySelector('.key-access-card');
        const predictionsContainer = document.getElementById('predictionsContainer');
        
        if (error.message.includes('Clé API invalide')) {
            keyAccessCard.classList.remove('d-none');
            keyAccessCard.style.opacity = '1';
            keyAccessCard.style.transform = 'translateY(0)';
            predictionsContainer.classList.add('d-none');
            showError(error.message);
        }
        throw error;
    }
}

// Gestionnaire principal
function unlockBtnHandler() {
    // Vérifier que les éléments nécessaires sont présents
    if (!document.getElementById('unlockBtn') || !document.getElementById('apiKeyInput')) {
        console.error('Éléments requis non trouvés');
        return;
    }
    
    const unlockBtn = document.getElementById('unlockBtn');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const keyAccessCard = document.querySelector('.key-access-card');
    const predictionsContainer = document.getElementById('predictionsContainer');
    
    unlockBtn.addEventListener('click', async function() {
        const apiKey = apiKeyInput.value.trim();
        
        if (!apiKey) {
            showError('Veuillez entrer votre clé API');
            return;
        }
        
        // Effet visuel
        unlockBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vérification...';
        unlockBtn.disabled = true;
        
        // Créer l'effet de déverrouillage
        const unlockEffect = document.createElement('div');
        unlockEffect.className = 'unlock-effect';
        document.body.appendChild(unlockEffect);
        
        try {
            const response = await fetch('/api/predict', {
                headers: {
                    'X-API-Key': apiKey
                }
            });
            
            if (response.status === 401) {
                throw new Error('Clé API invalide. Veuillez vérifier et réessayer.');
            }
            
            if (!response.ok) {
                throw new Error('Erreur de connexion au serveur');
            }
            
            const predictions = await response.json();
            
            // Enregistrer la clé valide
            localStorage.setItem('apiKey', apiKey);
            
            // Cacher la carte d'accès après un délai
            setTimeout(() => {
                keyAccessCard.style.opacity = '0';
                keyAccessCard.style.transform = 'translateY(-50px)';
                
                // Afficher les prédictions
                setTimeout(() => {
                    keyAccessCard.classList.add('d-none');
                    predictionsContainer.classList.remove('d-none');
                    const tipsSection = document.querySelector('.tips-section');
                    if (tipsSection) {
                        tipsSection.style.animation = 'slideUp 0.8s ease-out';
                    }
                    updatePredictions(predictions);
                }, 500);
            }, 1000);
            
        } catch (error) {
            showError(error.message);
            unlockBtn.innerHTML = '<i class="fas fa-lock-open"></i> Déverrouiller';
            unlockBtn.disabled = false;
        } finally {
            // Nettoyer l'effet visuel
            setTimeout(() => {
                if (unlockEffect.parentNode) {
                    unlockEffect.parentNode.removeChild(unlockEffect);
                }
            }, 1500);
        }
    });
    
    // Ajout du gestionnaire pour le bouton d'actualisation
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement...';
            refreshBtn.disabled = true;
            
            // Animation des prédictions
            const predictionsList = document.getElementById('predictionsList');
            if (predictionsList) {
                predictionsList.style.opacity = '0.5';
                predictionsList.style.transition = 'opacity 0.3s';
            }
            
            loadPredictions().then(() => {
                // Animation de retour
                if (predictionsList) predictionsList.style.opacity = '1';
            }).catch(() => {
                // Gérer l'erreur
            }).finally(() => {
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Prochaines prédictions';
                refreshBtn.disabled = false;
            });
        });
    }
    
    // Pré-remplir la clé si elle existe dans localStorage
    const savedKey = localStorage.getItem('apiKey');
    if (savedKey) {
        apiKeyInput.value = savedKey;
    }
    
    // Charger automatiquement les prédictions si une clé est déjà sauvegardée
    if (localStorage.getItem('apiKey')) {
        keyAccessCard.classList.add('d-none');
        predictionsContainer.classList.remove('d-none');
        
        // Afficher un état de chargement
        const container = document.getElementById('predictionsList');
        if (container) {
            container.innerHTML = `
                <div class="text-center py-4">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Chargement...</span>
                    </div>
                    <p class="mt-3 text-white">Chargement des prédictions...</p>
                </div>
            `;
        }
        
        loadPredictions().catch(() => {
            // En cas d'erreur, afficher le formulaire
            keyAccessCard.classList.remove('d-none');
            predictionsContainer.classList.add('d-none');
        });
    }
}

// Initialisation lorsque le DOM est chargé
document.addEventListener('DOMContentLoaded', unlockBtnHandler);