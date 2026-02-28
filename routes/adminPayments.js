const express = require("express");
const router = express.Router();
const { Payment, Subscription } = require("../models/Payment");
const isAdmin = require("../middlewares/isAdmin");

// Voir tous les paiements en attente
router.get("/admin/payments", isAdmin, async (req, res) => {
  const payments = await Payment.findAll({
    where: { status: "pending" },
    include: ["User"],
    order: [["createdAt", "DESC"]]
  });

  res.render("admin/payments", { payments });
});

// Approuver un paiement
router.post("/admin/payments/:id/approve", isAdmin, async (req, res) => {
  const payment = await Payment.findByPk(req.params.id);
  if (!payment) return res.redirect("/admin/payments");

  payment.status = "approved";
  await payment.save();

  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 1); // VIP 1 mois

  await Subscription.create({
    UserId: payment.UserId,
    startDate,
    endDate,
    status: "active"
  });

  res.redirect("/admin/payments");
});

// Refuser un paiement
router.post("/admin/payments/:id/reject", isAdmin, async (req, res) => {
  const payment = await Payment.findByPk(req.params.id);
  if (!payment) return res.redirect("/admin/payments");

  payment.status = "rejected";
  await payment.save();

  res.redirect("/admin/payments");
});

module.exports = router;