const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    provider: { type: String, enum: ["local", "google"], default: "local" },
    isVerified: { type: Boolean, default: false },

    plan: { type: String, enum: ["free", "pro"], default: "free" },
    dailyCount: { type: Number, default: 0 },
    dailyResetAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
