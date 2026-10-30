import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";
import { TASK_QUEUE } from "./shared.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function startWorker(): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  });

  const workflowsPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "workflows.ts",
  );

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities,
    maxConcurrentActivityTaskExecutions: Number(process.env.MAX_CONCURRENT_ACTIVITIES ?? 1),
  });

  void worker.run();
  return worker;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
