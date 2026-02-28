// models/Rating.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Rating', {
    team: { type: DataTypes.STRING, unique: true },
    rating: DataTypes.INTEGER,
    games: DataTypes.INTEGER
  });
};