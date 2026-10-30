import { startApi } from "./api/server.js";
import { resolveConfigRepo } from "./services/instance-settings.js";
import { ensureIntakeSchedule } from "./temporal/client.js";
import { startWorker } from "./temporal/worker.js";

async function main() {
  const repo = await resolveConfigRepo();
  console.log(`factory-config: ${repo}`);
  await startWorker();
  await ensureIntakeSchedule();
  startApi();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
