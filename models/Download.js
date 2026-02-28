const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Download = sequelize.define('Download', {
  count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

module.exports = Download;