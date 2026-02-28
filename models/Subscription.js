module.exports = (sequelize, DataTypes) => {
  const Subscription = sequelize.define("Subscription", {
    plan: {
      type: DataTypes.STRING,
      defaultValue: "vip"
    },
    startDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    endDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "active"
    }
  });

  Subscription.associate = (models) => {
    Subscription.belongsTo(models.User);
  };

  return Subscription;
};