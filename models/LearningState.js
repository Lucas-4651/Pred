// models/LearningState.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define('LearningState', {
    weights: DataTypes.JSON,
    metrics: DataTypes.JSON,
    homeAdvantageBase: DataTypes.FLOAT,
    homeAdvantageByTeam: DataTypes.JSON,
    learningRates: DataTypes.JSON,
    timestamp: DataTypes.BIGINT,
    extraState: DataTypes.JSON
  });
};