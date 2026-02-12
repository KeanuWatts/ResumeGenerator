import app from "./app.js";
import { connectDb } from "./db.js";

const PORT = parseInt(process.env.PORT || "4000", 10);

async function main() {
  await connectDb();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
