// models/Prediction.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Prediction', {
    match: DataTypes.STRING,
    home_team: DataTypes.STRING,
    away_team: DataTypes.STRING,
    prediction: DataTypes.STRING(1),
    actual_result: DataTypes.STRING(1),
    confidence: DataTypes.INTEGER,
    goals: DataTypes.INTEGER,
    exact_score: DataTypes.STRING,
    half_time: DataTypes.STRING(1),
    odds_1x2: DataTypes.STRING,
    odds_ht: DataTypes.STRING,
    home_form: DataTypes.FLOAT,
    away_form: DataTypes.FLOAT,
    model_snapshot: DataTypes.JSON,
    match_date: DataTypes.DATE,
    learning_applied: { type: DataTypes.BOOLEAN, defaultValue: false }
  });
};