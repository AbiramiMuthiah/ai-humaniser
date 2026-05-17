const express = require("express");
const router = express.Router();
const stripe = require("../services/stripe");
const User = require("../models/User"); // your user model
const authMiddleware = require("../middleware/auth");

router.post("/create-checkout-session", authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body; // "BASIC" | "PRO" | "UNLIMITED"

    let priceId;

    if (plan === "BASIC") priceId = process.env.STRIPE_BASIC_PRICE_ID;
    if (plan === "PRO") priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (plan === "UNLIMITED") priceId = process.env.STRIPE_UNLIMITED_PRICE_ID;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: req.user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Stripe session failed" });
  }
});

module.exports = router;