import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://factory:factory@localhost:5432/factory";

const client = postgres(url, { max: 10 });
export const db = drizzle(client, { schema });
export type Db = typeof db;
