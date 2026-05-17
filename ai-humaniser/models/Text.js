const mongoose = require("mongoose");

const textSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  input: { type: String, required: true },
  output: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("Text", textSchema);
