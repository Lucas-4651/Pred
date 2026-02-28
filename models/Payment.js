module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define("Payment", {
    method: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    transactionRef: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "pending" // pending | approved | rejected
    }
  });

  Payment.associate = (models) => {
    Payment.belongsTo(models.User);
  };

  return Payment;
};