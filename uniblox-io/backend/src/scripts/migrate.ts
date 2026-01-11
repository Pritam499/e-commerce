import { readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.development" });

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("Connected to database");

    // First, check if we need to alter existing tables
    console.log("Checking existing tables...");
    
    // Check if customers table has integer id (old schema)
    const customersCheck = await client.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'customers' AND column_name = 'id'
    `);
    
    if (customersCheck.rows.length > 0 && customersCheck.rows[0].data_type === 'integer') {
      console.log("⚠️  Detected old schema with integer customer IDs");
      console.log("⚠️  Dropping existing tables to migrate to UUID schema...");
      console.log("⚠️  All existing data will be lost!");
      
      // Drop all tables in correct order (respecting foreign keys)
      const dropOrder = [
        'order_items',
        'orders', 
        'cart_items',
        'discount_codes',
        'products',
        'categories',
        'customers'
      ];
      
      for (const table of dropOrder) {
        try {
          await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
          console.log(`✓ Dropped table: ${table}`);
        } catch (error: any) {
          console.log(`⚠️  Could not drop ${table}: ${error.message}`);
        }
      }
      
      // Drop enum type if it exists
      try {
        await client.query(`DROP TYPE IF EXISTS order_status CASCADE`);
        console.log(`✓ Dropped enum: order_status`);
      } catch (error: any) {
        // Ignore
      }
      
      console.log("✓ Old schema cleared, proceeding with migration...");
    }

    // Read the latest migration file
    const migrationFile = join(__dirname, "../drizzle/migrations/0000_silly_liz_osborn.sql");
    const sql = readFileSync(migrationFile, "utf-8");

    // Split by statement breakpoints and execute each statement
    const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter((s) => s.length > 0);

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await client.query(statement);
          console.log("✓ Executed statement");
        } catch (error: any) {
          // Ignore errors for "already exists" cases (handled by DO $$ blocks)
          if (!error.message.includes("already exists") && 
              !error.message.includes("duplicate") &&
              !error.message.includes("does not exist")) {
            console.error("Error executing statement:", error.message);
            throw error;
          } else {
            console.log("⚠️  Skipped (already exists or not applicable)");
          }
        }
      }
    }

    // If discount_codes table exists but doesn't have customer_id, add it
    const discountCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'discount_codes' AND column_name = 'customer_id'
    `);
    
    if (discountCheck.rows.length === 0) {
      console.log("Adding customer_id column to discount_codes...");
      try {
        await client.query(`
          ALTER TABLE discount_codes 
          ADD COLUMN customer_id varchar(36) REFERENCES customers(id)
        `);
        console.log("✓ Added customer_id column to discount_codes");
      } catch (error: any) {
        if (!error.message.includes("already exists")) {
          throw error;
        }
      }
    }

    console.log("✓ Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
