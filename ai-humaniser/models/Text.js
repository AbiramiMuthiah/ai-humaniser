const mongoose = require("mongoose");

const textSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    input: {
      type: String,
      required: true,
    },
    output: {
      type: String,
      required: true,
    },
    // ✅ FIXED: added mode field (server.js saves mode but old schema didn't have it)
    mode: {
      type: String,
      enum: ["standard", "academic", "creative", "casual"],
      default: "standard",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Text", textSchema);