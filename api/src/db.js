import mongoose from "mongoose";
import { Template } from "./models/Template.js";

export async function connectDb() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/resumegen";
  await mongoose.connect(uri);
  const hasDefault = await Template.exists({ isDefault: true });
  if (!hasDefault) {
    await Template.create({ name: "Default", description: "Default resume template", isDefault: true, userId: null, templateType: "reactive_resume" });
  }
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
