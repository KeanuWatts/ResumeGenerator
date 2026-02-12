import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    profile: {
      fullName: { type: String, required: true },
      phone: String,
      location: { city: String, state: String, country: String },
      linkedin: String,
      website: String,
      headline: String,
    },
    settings: {
      defaultTemplateId: mongoose.Schema.Types.ObjectId,
      aiPreferences: { temperature: Number, model: String },
      exportFormat: String,
    },
    subscription: { tier: String, expiresAt: Date, features: [String] },
    apiKeys: { deepseek: String, reactiveResume: String },
    refreshTokens: [{ token: String, expiresAt: Date }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

export const User = mongoose.model("User", userSchema);
