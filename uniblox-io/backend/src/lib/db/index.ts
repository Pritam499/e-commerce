import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as schema from "../../drizzle/schema";
import * as relations from "../../drizzle/relations";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/ecommerce",
});

// Combine schema and relations for drizzle
export const db = drizzle(pool, { schema: { ...schema, ...relations } });

export type Database = typeof db;
