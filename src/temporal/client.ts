import { Client, Connection } from "@temporalio/client";
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

const INTAKE_SCHEDULE_ID = "factory-intake";

/** Remove legacy Temporal intake schedule so it cannot compete with in-process polling. */
export async function deleteIntakeScheduleIfExists(): Promise<void> {
  const client = await getTemporalClient();
  try {
    const handle = client.schedule.getHandle(INTAKE_SCHEDULE_ID);
    await handle.delete();
    console.log(`deleted Temporal schedule ${INTAKE_SCHEDULE_ID}`);
  } catch {
    // already gone
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

export { TASK_QUEUE };
