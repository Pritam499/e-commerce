import { relations } from "drizzle-orm";
import {
  categories,
  products,
  customers,
  cartItems,
  orders,
  orderItems,
  discountCodes,
  productViews,
  paymentLogs,
  refundLogs,
  cartSessions,
  cartRecovery,
} from "./schema";

// Categories relations
export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

// Products relations
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  cartItems: many(cartItems),
  orderItems: many(orderItems),
  productViews: many(productViews),
}));

// Customers relations
export const customersRelations = relations(customers, ({ many }) => ({
  cartItems: many(cartItems),
  orders: many(orders),
  discountCodes: many(discountCodes),
  productViews: many(productViews),
  cartSessions: many(cartSessions),
  cartRecovery: many(cartRecovery),
}));

// Cart items relations
export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  customer: one(customers, {
    fields: [cartItems.customerId],
    references: [customers.id],
  }),
  product: one(products, {
    fields: [cartItems.productId],
    references: [products.id],
  }),
}));

// Orders relations
export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  discountCode: one(discountCodes, {
    fields: [orders.discountCodeId],
    references: [discountCodes.id],
  }),
  orderItems: many(orderItems),
  paymentLogs: many(paymentLogs),
  refundLogs: many(refundLogs),
}));

// Order items relations
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

// Discount codes relations
export const discountCodesRelations = relations(discountCodes, ({ one, many }) => ({
  customer: one(customers, {
    fields: [discountCodes.customerId],
    references: [customers.id],
  }),
  orders: many(orders),
}));

// Product views relations
export const productViewsRelations = relations(productViews, ({ one }) => ({
  customer: one(customers, {
    fields: [productViews.customerId],
    references: [customers.id],
  }),
  product: one(products, {
    fields: [productViews.productId],
    references: [products.id],
  }),
}));

// Payment logs relations
export const paymentLogsRelations = relations(paymentLogs, ({ one }) => ({
  order: one(orders, {
    fields: [paymentLogs.orderId],
    references: [orders.id],
  }),
}));

// Refund logs relations
export const refundLogsRelations = relations(refundLogs, ({ one }) => ({
  order: one(orders, {
    fields: [refundLogs.orderId],
    references: [orders.id],
  }),
}));

// Cart sessions relations
export const cartSessionsRelations = relations(cartSessions, ({ one }) => ({
  customer: one(customers, {
    fields: [cartSessions.customerId],
    references: [customers.id],
  }),
}));

// Cart recovery relations
export const cartRecoveryRelations = relations(cartRecovery, ({ one }) => ({
  customer: one(customers, {
    fields: [cartRecovery.customerId],
    references: [customers.id],
  }),
}));
