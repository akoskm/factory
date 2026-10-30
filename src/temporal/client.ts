import { Client, Connection, ScheduleClient } from "@temporalio/client";
import { TASK_QUEUE } from "./shared.js";

let clientPromise: Promise<Client> | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
      });
      return new Client({ connection });
    })();
  }
  return clientPromise;
}

export async function ensureIntakeSchedule(): Promise<void> {
  const client = await getTemporalClient();
  const scheduleId = "factory-intake";
  try {
    const handle = client.schedule.getHandle(scheduleId);
    await handle.describe();
  } catch {
    await client.schedule.create({
      scheduleId,
      spec: {
        intervals: [{ every: "30s" }],
      },
      action: {
        type: "startWorkflow",
        workflowType: "intakeWorkflow",
        taskQueue: TASK_QUEUE,
        args: [],
      },
    });
  }
}

export async function signalReview(
  workflowId: string,
  decision: "approve" | "request_changes",
  note?: string,
): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal("review", { decision, note });
}

export { TASK_QUEUE, ScheduleClient };
