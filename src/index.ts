import { runSync } from "./run-sync.js";

runSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
