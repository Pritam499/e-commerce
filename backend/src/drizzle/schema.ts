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
  index,
  uniqueIndex,
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
}, (table) => ({
  // Indexes
  nameIdx: index("categories_name_idx").on(table.name),
  createdAtIdx: index("categories_created_at_idx").on(table.createdAt),
}));

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
  rating: decimal("rating", { precision: 2, scale: 1 }).default("4.0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Indexes
  categoryIdIdx: index("products_category_id_idx").on(table.categoryId),
  nameIdx: index("products_name_idx").on(table.name),
  priceIdx: index("products_price_idx").on(table.price),
  ratingIdx: index("products_rating_idx").on(table.rating),
  stockIdx: index("products_stock_idx").on(table.stock),
  createdAtIdx: index("products_created_at_idx").on(table.createdAt),
  updatedAtIdx: index("products_updated_at_idx").on(table.updatedAt),
  // Composite indexes for common queries
  categoryRatingIdx: index("products_category_rating_idx").on(table.categoryId, table.rating.desc()),
  categoryPriceIdx: index("products_category_price_idx").on(table.categoryId, table.price),
  priceRatingIdx: index("products_price_rating_idx").on(table.price, table.rating.desc()),
}));

// Customers table
export const customers = pgTable("customers", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Indexes
  emailIdx: uniqueIndex("customers_email_idx").on(table.email),
  createdAtIdx: index("customers_created_at_idx").on(table.createdAt),
  nameIdx: index("customers_name_idx").on(table.name),
}));

// Cart items table (extended for persistence)
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
}, (table) => ({
  // Indexes
  customerIdIdx: index("cart_items_customer_id_idx").on(table.customerId),
  productIdIdx: index("cart_items_product_id_idx").on(table.productId),
  createdAtIdx: index("cart_items_created_at_idx").on(table.createdAt),
  updatedAtIdx: index("cart_items_updated_at_idx").on(table.updatedAt),
  // Composite indexes for common queries
  customerProductIdx: uniqueIndex("cart_items_customer_product_idx").on(table.customerId, table.productId),
  customerCreatedIdx: index("cart_items_customer_created_idx").on(table.customerId, table.createdAt),
}));

// Cart sessions table for persistent cart management
export const cartSessions = pgTable("cart_sessions", {
  id: stringPrimaryId("id"),
  customerId: varchar("customer_id", { length: 36 })
    .references(() => customers.id)
    .notNull(),
  sessionData: text("session_data"), // JSON string for cart data
  lastActivity: timestamp("last_activity").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Indexes
  customerIdIdx: index("cart_sessions_customer_id_idx").on(table.customerId),
  lastActivityIdx: index("cart_sessions_last_activity_idx").on(table.lastActivity),
  expiresAtIdx: index("cart_sessions_expires_at_idx").on(table.expiresAt),
  isActiveIdx: index("cart_sessions_is_active_idx").on(table.isActive),
  createdAtIdx: index("cart_sessions_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  customerActiveIdx: index("cart_sessions_customer_active_idx").on(table.customerId, table.isActive),
  activeExpiresIdx: index("cart_sessions_active_expires_idx").on(table.isActive, table.expiresAt),
  lastActivityExpiresIdx: index("cart_sessions_last_activity_expires_idx").on(table.lastActivity, table.expiresAt),
}));

// Cart recovery table for abandoned cart recovery
export const cartRecovery = pgTable("cart_recovery", {
  id: stringPrimaryId("id"),
  customerId: varchar("customer_id", { length: 36 })
    .references(() => customers.id)
    .notNull(),
  recoveryToken: varchar("recovery_token", { length: 255 }).unique().notNull(),
  cartSnapshot: text("cart_snapshot"), // JSON string of cart at abandonment time
  emailSent: boolean("email_sent").default(false).notNull(),
  emailSentAt: timestamp("email_sent_at"),
  recovered: boolean("recovered").default(false).notNull(),
  recoveredAt: timestamp("recovered_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Indexes
  customerIdIdx: index("cart_recovery_customer_id_idx").on(table.customerId),
  recoveryTokenIdx: uniqueIndex("cart_recovery_token_idx").on(table.recoveryToken),
  emailSentIdx: index("cart_recovery_email_sent_idx").on(table.emailSent),
  recoveredIdx: index("cart_recovery_recovered_idx").on(table.recovered),
  expiresAtIdx: index("cart_recovery_expires_at_idx").on(table.expiresAt),
  createdAtIdx: index("cart_recovery_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  recoveredExpiresIdx: index("cart_recovery_recovered_expires_idx").on(table.recovered, table.expiresAt),
  emailSentCreatedIdx: index("cart_recovery_email_sent_created_idx").on(table.emailSent, table.createdAt),
}));

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
}, (table) => ({
  // Indexes
  codeIdx: uniqueIndex("discount_codes_code_idx").on(table.code),
  customerIdIdx: index("discount_codes_customer_id_idx").on(table.customerId),
  isUsedIdx: index("discount_codes_is_used_idx").on(table.isUsed),
  isAvailableIdx: index("discount_codes_is_available_idx").on(table.isAvailable),
  createdAtIdx: index("discount_codes_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  customerAvailableIdx: index("discount_codes_customer_available_idx").on(table.customerId, table.isAvailable),
  availableUsedIdx: index("discount_codes_available_used_idx").on(table.isAvailable, table.isUsed),
}));

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
  // Payment-related fields
  idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(),
  paymentStatus: varchar("payment_status", { length: 50 }).default("pending").notNull(),
  paymentGatewayId: varchar("payment_gateway_id", { length: 255 }),
  paymentAttempts: integer("payment_attempts").default(0).notNull(),
  lastPaymentAttempt: timestamp("last_payment_attempt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Indexes
  customerIdIdx: index("orders_customer_id_idx").on(table.customerId),
  discountCodeIdIdx: index("orders_discount_code_id_idx").on(table.discountCodeId),
  statusIdx: index("orders_status_idx").on(table.status),
  paymentStatusIdx: index("orders_payment_status_idx").on(table.paymentStatus),
  idempotencyKeyIdx: uniqueIndex("orders_idempotency_key_idx").on(table.idempotencyKey),
  paymentGatewayIdIdx: index("orders_payment_gateway_id_idx").on(table.paymentGatewayId),
  createdAtIdx: index("orders_created_at_idx").on(table.createdAt),
  updatedAtIdx: index("orders_updated_at_idx").on(table.updatedAt),
  // Composite indexes for common queries
  customerStatusIdx: index("orders_customer_status_idx").on(table.customerId, table.status),
  customerCreatedIdx: index("orders_customer_created_idx").on(table.customerId, table.createdAt),
  statusCreatedIdx: index("orders_status_created_idx").on(table.status, table.createdAt),
  paymentStatusAttemptsIdx: index("orders_payment_status_attempts_idx").on(table.paymentStatus, table.paymentAttempts),
}));

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
}, (table) => ({
  // Indexes
  orderIdIdx: index("order_items_order_id_idx").on(table.orderId),
  productIdIdx: index("order_items_product_id_idx").on(table.productId),
  createdAtIdx: index("order_items_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  orderProductIdx: index("order_items_order_product_idx").on(table.orderId, table.productId),
}));

// Payment logs table for audit trail
export const paymentLogs = pgTable("payment_logs", {
  id: stringPrimaryId("id"),
  orderId: varchar("order_id", { length: 128 })
    .references(() => orders.id)
    .notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }),
  gatewayResponse: text("gateway_response"), // JSON stored as text
  status: varchar("status", { length: 50 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Indexes
  orderIdIdx: index("payment_logs_order_id_idx").on(table.orderId),
  idempotencyKeyIdx: index("payment_logs_idempotency_key_idx").on(table.idempotencyKey),
  statusIdx: index("payment_logs_status_idx").on(table.status),
  createdAtIdx: index("payment_logs_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  orderStatusIdx: index("payment_logs_order_status_idx").on(table.orderId, table.status),
  statusCreatedIdx: index("payment_logs_status_created_idx").on(table.status, table.createdAt),
}));

// Refund logs table
export const refundLogs = pgTable("refund_logs", {
  id: stringPrimaryId("id"),
  orderId: varchar("order_id", { length: 128 })
    .references(() => orders.id)
    .notNull(),
  refundId: varchar("refund_id", { length: 255 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 255 }),
  status: varchar("status", { length: 50 }).default("pending").notNull(),
  gatewayResponse: text("gateway_response"), // JSON stored as text
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Indexes
  orderIdIdx: index("refund_logs_order_id_idx").on(table.orderId),
  refundIdIdx: index("refund_logs_refund_id_idx").on(table.refundId),
  statusIdx: index("refund_logs_status_idx").on(table.status),
  createdAtIdx: index("refund_logs_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  orderStatusIdx: index("refund_logs_order_status_idx").on(table.orderId, table.status),
}));

// Product views table for recommendation system
export const productViews = pgTable("product_views", {
  id: stringPrimaryId("id"),
  customerId: varchar("customer_id", { length: 36 })
    .references(() => customers.id)
    .notNull(),
  productId: varchar("product_id", { length: 128 })
    .references(() => products.id)
    .notNull(),
  viewedAt: timestamp("viewed_at").defaultNow().notNull(),
  sessionId: varchar("session_id", { length: 128 }),
}, (table) => ({
  // Indexes
  customerIdIdx: index("product_views_customer_id_idx").on(table.customerId),
  productIdIdx: index("product_views_product_id_idx").on(table.productId),
  viewedAtIdx: index("product_views_viewed_at_idx").on(table.viewedAt),
  sessionIdIdx: index("product_views_session_id_idx").on(table.sessionId),
  // Composite indexes for common queries
  customerViewedIdx: index("product_views_customer_viewed_idx").on(table.customerId, table.viewedAt),
  productViewedIdx: index("product_views_product_viewed_idx").on(table.productId, table.viewedAt),
  sessionViewedIdx: index("product_views_session_viewed_idx").on(table.sessionId, table.viewedAt),
}));
