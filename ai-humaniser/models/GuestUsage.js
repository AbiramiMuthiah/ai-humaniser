// Place this file at: backend/models/GuestUsage.js
//
// Tracks how many free trial humanisations an anonymous visitor has used,
// keyed by a guestId the frontend generates and stores in localStorage.
// This is deliberately simple (no IP tracking / fingerprinting) — good
// enough to make clearing localStorage the only way to reset a trial,
// without adding invasive tracking for a free-tier feature.

const mongoose = require("mongoose");

const GuestUsageSchema = new mongoose.Schema({
  guestId: { type: String, required: true, unique: true, index: true },
  count: { type: Number, default: 0 },
  lastUsedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.models.GuestUsage || mongoose.model("GuestUsage", GuestUsageSchema);