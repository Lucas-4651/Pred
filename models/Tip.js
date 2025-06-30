const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Tip = sequelize.define('Tip', {
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    defaultValue: 'general'
  }
});

module.exports = Tip;