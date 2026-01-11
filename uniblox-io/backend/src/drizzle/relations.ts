import { relations } from "drizzle-orm";
import {
  categories,
  products,
  customers,
  cartItems,
  orders,
  orderItems,
  discountCodes,
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
}));

// Customers relations
export const customersRelations = relations(customers, ({ many }) => ({
  cartItems: many(cartItems),
  orders: many(orders),
  discountCodes: many(discountCodes),
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
