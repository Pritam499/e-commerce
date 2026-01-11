import {
  pgTable,
  serial,
  varchar,
  text,
  decimal,
  integer,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

// Helper function for string primary keys
const stringPrimaryId = (col: string) =>
  varchar(col, { length: 128 })
    .primaryKey()
    .notNull()
    .$defaultFn(() => createId());

// Enums
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "completed",
  "cancelled",
]);

// Categories table
export const categories = pgTable("categories", {
  id: stringPrimaryId("id"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Products table
export const products = pgTable("products", {
  id: stringPrimaryId("id"),
  categoryId: varchar("category_id", { length: 128 })
    .references(() => categories.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  stock: integer("stock").default(0).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Customers table
export const customers = pgTable("customers", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Cart items table
export const cartItems = pgTable("cart_items", {
  id: stringPrimaryId("id"),
  customerId: varchar("customer_id", { length: 36 })
    .references(() => customers.id)
    .notNull(),
  productId: varchar("product_id", { length: 128 })
    .references(() => products.id)
    .notNull(),
  quantity: integer("quantity").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Discount codes table
export const discountCodes = pgTable("discount_codes", {
  id: stringPrimaryId("id"),
  code: varchar("code", { length: 50 }).notNull().unique(),
  discountPercentage: integer("discount_percentage").default(10).notNull(),
  isUsed: boolean("is_used").default(false).notNull(),
  isAvailable: boolean("is_available").default(false).notNull(),
  customerId: varchar("customer_id", { length: 36 }).references(
    () => customers.id
  ), // Track which customer this discount belongs to
  orderNumberGenerated: integer("order_number_generated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Orders table
export const orders = pgTable("orders", {
  id: stringPrimaryId("id"),
  customerId: varchar("customer_id", { length: 36 })
    .references(() => customers.id)
    .notNull(),
  discountCodeId: varchar("discount_code_id", { length: 128 }).references(
    () => discountCodes.id
  ),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 })
    .default("0")
    .notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  status: orderStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Order items table
export const orderItems = pgTable("order_items", {
  id: stringPrimaryId("id"),
  orderId: varchar("order_id", { length: 128 })
    .references(() => orders.id)
    .notNull(),
  productId: varchar("product_id", { length: 128 })
    .references(() => products.id)
    .notNull(),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
