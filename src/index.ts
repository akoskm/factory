import { startApi } from "./api/server.js";
import { ensureIntakeSchedule } from "./temporal/client.js";
import { startWorker } from "./temporal/worker.js";

async function main() {
  await startWorker();
  await ensureIntakeSchedule();
  startApi();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
