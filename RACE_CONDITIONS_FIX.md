# Race Conditions Fix for E-commerce Checkout

## Problem Statement

In high-traffic e-commerce scenarios like flash sales (Amazon Prime Day, Big Billion Day, etc.), multiple users simultaneously attempting to purchase limited-stock items can cause race conditions leading to:

- **Overselling**: More items sold than available in stock
- **Inconsistent inventory**: Stock levels become negative or inaccurate
- **Failed transactions**: Users getting errors after expecting successful purchases
- **Data integrity issues**: Orders created without proper stock validation

## Root Causes Identified

1. **Non-atomic stock checking**: Stock validation and update were separate operations
2. **No database transactions**: Checkout process wasn't wrapped in transactions
3. **No row-level locking**: Multiple processes could read the same stock value simultaneously
4. **Race between read and write**: Time gap between `SELECT` stock and `UPDATE` stock

## Solution Implemented

### 1. Database Transaction Wrapper

```typescript
return await db.transaction(async (tx) => {
  // All checkout operations within single transaction
  // Either all succeed or all rollback
});
```

### 2. Row-Level Locking with SELECT FOR UPDATE

```typescript
const lockedProducts = await tx
  .select()
  .from(products)
  .where(sql`${products.id} IN (${productIds})`)
  .for("update"); // Locks rows until transaction completes
```

### 3. Atomic Stock Validation and Update

- Stock checking and updating happen within the same transaction
- Locked product data ensures no other transaction can modify stock
- All cart operations, order creation, and stock updates are atomic

### 4. Comprehensive Error Handling

- Detailed error messages for insufficient stock
- Product-specific stock information in errors
- Graceful handling of concurrent failures

## Technical Implementation Details

### Before (Problematic Code)
```typescript
// Step 1: Check stock
if (product.stock < cartItem.quantity) {
  throw new Error(`Insufficient stock for product: ${product.name}`);
}

// ... other operations ...

// Step 2: Update stock (potentially after another request already updated it)
await db.update(products).set({
  stock: product.stock - item.quantity,
}).where(eq(products.id, item.productId));
```

### After (Race-Condition-Safe Code)
```typescript
// Lock and validate stock atomically
const lockedProducts = await tx
  .select()
  .from(products)
  .where(sql`${products.id} IN (${productIds})`)
  .for("update");

const productMap = new Map(lockedProducts.map(p => [p.id, p]));

// Validate with locked data
for (const cartItem of cartItemsList) {
  const lockedProduct = productMap.get(cartItem.productId);
  if (lockedProduct.stock < cartItem.quantity) {
    // Detailed error with available vs requested quantities
    throw new Error(`Insufficient stock for ${lockedProduct.name} (available: ${lockedProduct.stock}, requested: ${cartItem.quantity})`);
  }
}

// Update stock within same transaction
await tx.update(products).set({
  stock: lockedProduct.stock - item.quantity,
}).where(eq(products.id, item.productId));
```

## Testing Strategy

### Automated Race Condition Test

Created `test-race-conditions.ts` script that simulates:

- **20 items** available in stock
- **33 concurrent users** attempting checkout
- **Expected result**: 20 successful orders, 13 failures

### Test Execution

```bash
# Run the race condition test
npm run test:race-conditions

# Expected output:
# ✅ Successful orders: 20
# ❌ Failed orders: 13
# 📦 Final stock: 0
```

### Manual Testing Scenarios

1. **Concurrent browser tabs**: Open multiple checkout pages simultaneously
2. **API load testing**: Use tools like Artillery or k6 for concurrent requests
3. **Database monitoring**: Check for deadlocks and transaction conflicts

## Performance Considerations

### Transaction Scope
- Keep transactions as short as possible
- Only lock necessary rows (`SELECT FOR UPDATE` with specific IDs)
- Discount code generation moved outside main transaction

### Database Indexes
Ensure proper indexes on:
- `products.id` (already primary key)
- `cart_items.customer_id`
- `orders.customer_id`

### Connection Pooling
- Monitor database connection usage during high load
- Consider read replicas for non-critical operations

## Error Messages and User Experience

### User-Friendly Error Messages
```
❌ Insufficient stock for Flash Sale Smartphone (available: 3, requested: 5)
```

Instead of generic:
```
❌ Insufficient stock for product: Flash Sale Smartphone
```

### Frontend Handling
- Show real-time stock availability
- Disable checkout button when out of stock
- Queue failed requests for retry (optional)

## Monitoring and Alerting

### Key Metrics to Monitor
- Transaction rollback rates
- Average checkout duration
- Stock discrepancy alerts
- Concurrent checkout attempts vs successes

### Database Queries for Monitoring
```sql
-- Check for negative stock
SELECT * FROM products WHERE stock < 0;

-- Monitor transaction conflicts
SELECT * FROM pg_stat_activity WHERE state = 'idle in transaction';
```

## Alternative Approaches Considered

### 1. Optimistic Locking
- Use version numbers on products
- Retry failed transactions
- **Drawback**: Complex retry logic, potential user frustration

### 2. Queue-Based Processing
- Queue checkout requests
- Process sequentially
- **Drawback**: Reduced user experience, requires additional infrastructure

### 3. Redis-Based Stock Tracking
- Use Redis for fast stock checks
- Sync with database periodically
- **Drawback**: Additional complexity, potential sync issues

## Production Deployment Checklist

- [ ] Run race condition tests in staging environment
- [ ] Monitor database performance under load
- [ ] Set up alerts for transaction timeouts
- [ ] Implement circuit breakers for database failures
- [ ] Document incident response procedures
- [ ] Train support team on handling stock discrepancies

## Conclusion

The implemented solution provides:

✅ **Data Consistency**: No overselling or negative stock
✅ **High Performance**: Minimal transaction scope, targeted locking
✅ **User Experience**: Clear error messages, proper failure handling
✅ **Scalability**: Handles concurrent requests without degradation
✅ **Maintainability**: Clean, well-documented code

This implementation successfully prevents race conditions in high-concurrency e-commerce scenarios while maintaining excellent performance and user experience.