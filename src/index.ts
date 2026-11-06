import { startApi } from "./api/server.js";
import { resolveConfigRepo } from "./services/instance-settings.js";
import { createIntakeLoop } from "./services/intake-loop.js";
import { parseIntakeIntervalMs, runDefaultIntakePass } from "./services/intake.js";
import { deleteIntakeScheduleIfExists } from "./temporal/client.js";
import { startWorker } from "./temporal/worker.js";

const INTAKE_INTERVAL_MS = parseIntakeIntervalMs(process.env.INTAKE_INTERVAL_MS);

async function main() {
  const repo = await resolveConfigRepo();
  console.log(`factory-config: ${repo}`);
  await startWorker();
  await deleteIntakeScheduleIfExists();
  const loop = createIntakeLoop({
    intervalMs: INTAKE_INTERVAL_MS,
    runPass: runDefaultIntakePass,
  });
  loop.start();
  const stopIntake = () => loop.stop();
  process.on("SIGTERM", stopIntake);
  process.on("SIGINT", stopIntake);
  startApi();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
