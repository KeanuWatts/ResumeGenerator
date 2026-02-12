import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongod;

export async function startMemoryMongo() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  return mongod.getUri();
}

export async function stopMemoryMongo() {
  if (mongod) {
    await mongoose.disconnect();
    await mongod.stop();
  }
}
