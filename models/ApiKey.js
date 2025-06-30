const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ApiKey = sequelize.define('ApiKey', {
  key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  owner: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastUsed: {
    type: DataTypes.DATE,
    allowNull: true
  },
  usageCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

module.exports = ApiKey;