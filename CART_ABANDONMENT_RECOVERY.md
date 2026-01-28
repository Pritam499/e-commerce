# Cart Abandonment Recovery & Persistent Storage System

## Problem Statement

Cart abandonment is a critical issue in e-commerce, costing billions annually. Current issues:

1. **Session-Based Cart Loss**: Carts disappear when browser sessions expire
2. **No Cart Persistence**: Cart data isn't saved across devices/sessions
3. **No Recovery Mechanism**: No way to recover lost carts
4. **Poor User Experience**: Users lose progress and have to start over
5. **Revenue Loss**: Abandoned carts represent lost sales opportunities

## Solution Architecture

### 1. Persistent Cart Storage

**Database Schema Extensions**
```sql
-- Extend cart_items table with persistence features
ALTER TABLE cart_items ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE cart_items ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();

-- Add cart_sessions table for session management
CREATE TABLE cart_sessions (
  id VARCHAR(128) PRIMARY KEY,
  customer_id VARCHAR(36) REFERENCES customers(id),
  session_data JSONB,
  last_activity TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add cart_recovery table for abandoned cart recovery
CREATE TABLE cart_recovery (
  id VARCHAR(128) PRIMARY KEY,
  customer_id VARCHAR(36) REFERENCES customers(id),
  recovery_token VARCHAR(255) UNIQUE,
  cart_snapshot JSONB,
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMP,
  recovered BOOLEAN DEFAULT false,
  recovered_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX idx_cart_sessions_customer_id ON cart_sessions(customer_id);
CREATE INDEX idx_cart_sessions_expires_at ON cart_sessions(expires_at);
CREATE INDEX idx_cart_recovery_customer_id ON cart_recovery(customer_id);
CREATE INDEX idx_cart_recovery_token ON cart_recovery(recovery_token);
CREATE INDEX idx_cart_recovery_expires_at ON cart_recovery(expires_at);
```

### 2. Cart Session Management

**Enhanced Session Handling**
```typescript
interface CartSession {
  id: string;
  customerId: string;
  items: CartItem[];
  lastActivity: Date;
  expiresAt: Date;
  isActive: boolean;
}

class CartSessionManager {
  private sessionTimeout = 30 * 24 * 60 * 60 * 1000; // 30 days
  private activityTimeout = 24 * 60 * 60 * 1000; // 24 hours

  // Create or update session
  async updateSession(customerId: string, cartItems: CartItem[]) {
    const sessionId = this.getOrCreateSessionId(customerId);
    const expiresAt = new Date(Date.now() + this.sessionTimeout);

    await db.insert(cartSessions).values({
      id: sessionId,
      customerId,
      sessionData: {
        items: cartItems,
        lastActivity: new Date(),
        itemCount: cartItems.length,
        totalValue: this.calculateCartTotal(cartItems)
      },
      lastActivity: new Date(),
      expiresAt,
      isActive: true
    }).onConflictDoUpdate({
      target: cartSessions.id,
      set: {
        sessionData: {
          items: cartItems,
          lastActivity: new Date(),
          itemCount: cartItems.length,
          totalValue: this.calculateCartTotal(cartItems)
        },
        lastActivity: new Date(),
        expiresAt,
        isActive: true
      }
    });
  }

  // Get session data
  async getSession(customerId: string): Promise<CartSession | null> {
    const session = await db.query.cartSessions.findFirst({
      where: and(
        eq(cartSessions.customerId, customerId),
        eq(cartSessions.isActive, true),
        gt(cartSessions.expiresAt, new Date())
      )
    });

    if (!session) return null;

    return {
      id: session.id,
      customerId: session.customerId,
      items: session.sessionData?.items || [],
      lastActivity: session.lastActivity,
      expiresAt: session.expiresAt,
      isActive: session.isActive
    };
  }

  // Check for abandoned carts
  async findAbandonedCarts(): Promise<CartRecovery[]> {
    const abandonedThreshold = new Date(Date.now() - this.activityTimeout);

    const abandonedSessions = await db.query.cartSessions.findMany({
      where: and(
        lt(cartSessions.lastActivity, abandonedThreshold),
        eq(cartSessions.isActive, true),
        gt(cartSessions.expiresAt, new Date())
      ),
      with: {
        customer: true
      }
    });

    return abandonedSessions.map(session => ({
      customerId: session.customerId,
      customerEmail: session.customer?.email,
      cartItems: session.sessionData?.items || [],
      lastActivity: session.lastActivity,
      totalValue: session.sessionData?.totalValue || 0
    }));
  }
}
```

### 3. Cart Recovery System

**Recovery Token Generation**
```typescript
class CartRecoveryManager {
  private recoveryTokenExpiry = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Create recovery token for abandoned cart
  async createRecoveryToken(customerId: string): Promise<string> {
    const cartItems = await getCartItems(customerId);
    if (cartItems.length === 0) return null;

    const recoveryToken = this.generateSecureToken();
    const expiresAt = new Date(Date.now() + this.recoveryTokenExpiry);

    await db.insert(cartRecovery).values({
      id: `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      customerId,
      recoveryToken,
      cartSnapshot: {
        items: cartItems,
        totalValue: this.calculateCartTotal(cartItems),
        itemCount: cartItems.length
      },
      expiresAt
    });

    return recoveryToken;
  }

  // Recover cart from token
  async recoverCart(recoveryToken: string): Promise<CartItem[] | null> {
    const recovery = await db.query.cartRecovery.findFirst({
      where: and(
        eq(cartRecovery.recoveryToken, recoveryToken),
        eq(cartRecovery.recovered, false),
        gt(cartRecovery.expiresAt, new Date())
      )
    });

    if (!recovery) return null;

    // Mark as recovered
    await db.update(cartRecovery)
      .set({
        recovered: true,
        recoveredAt: new Date()
      })
      .where(eq(cartRecovery.id, recovery.id));

    return recovery.cartSnapshot?.items || [];
  }

  // Generate secure recovery token
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
```

### 4. Email System for Cart Recovery

**Email Templates and Scheduling**
```typescript
interface AbandonedCartEmail {
  customerId: string;
  customerEmail: string;
  cartItems: CartItem[];
  totalValue: number;
  recoveryUrl: string;
  lastActivity: Date;
}

class CartAbandonmentEmailService {
  private emailTemplates = {
    firstReminder: {
      subject: "Don't forget your items in cart! 🛒",
      template: "first_reminder.html"
    },
    secondReminder: {
      subject: "Your cart is waiting for you! ⏰",
      template: "second_reminder.html"
    },
    finalReminder: {
      subject: "Last chance to complete your purchase",
      template: "final_reminder.html"
    }
  };

  // Send abandonment email
  async sendAbandonmentEmail(abandonedCart: AbandonedCartEmail, reminderType: 'first' | 'second' | 'final' = 'first') {
    const template = this.emailTemplates[`${reminderType}Reminder`];

    const emailData = {
      customerName: abandonedCart.customerEmail.split('@')[0],
      cartItems: abandonedCart.cartItems,
      totalValue: abandonedCart.totalValue,
      recoveryUrl: abandonedCart.recoveryUrl,
      lastActivity: abandonedCart.lastActivity,
      itemCount: abandonedCart.cartItems.length
    };

    await this.sendEmail({
      to: abandonedCart.customerEmail,
      subject: template.subject,
      template: template.template,
      data: emailData
    });

    // Update recovery record
    await db.update(cartRecovery)
      .set({
        emailSent: true,
        emailSentAt: new Date()
      })
      .where(eq(cartRecovery.customerId, abandonedCart.customerId));
  }

  // Schedule abandonment emails
  async scheduleAbandonmentEmails() {
    const abandonedCarts = await cartSessionManager.findAbandonedCarts();

    for (const cart of abandonedCarts) {
      const recoveryToken = await cartRecoveryManager.createRecoveryToken(cart.customerId);
      const recoveryUrl = `${process.env.FRONTEND_URL}/cart/recover/${recoveryToken}`;

      const emailData: AbandonedCartEmail = {
        customerId: cart.customerId,
        customerEmail: cart.customerEmail,
        cartItems: cart.cartItems,
        totalValue: cart.totalValue,
        recoveryUrl,
        lastActivity: cart.lastActivity
      };

      // Send first reminder after 1 hour
      if (this.shouldSendFirstReminder(cart.lastActivity)) {
        await this.sendAbandonmentEmail(emailData, 'first');
      }

      // Send second reminder after 24 hours
      if (this.shouldSendSecondReminder(cart.lastActivity)) {
        await this.sendAbandonmentEmail(emailData, 'second');
      }

      // Send final reminder after 72 hours
      if (this.shouldSendFinalReminder(cart.lastActivity)) {
        await this.sendAbandonmentEmail(emailData, 'final');
      }
    }
  }

  private shouldSendFirstReminder(lastActivity: Date): boolean {
    const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
    return hoursSinceActivity >= 1 && hoursSinceActivity < 24;
  }

  private shouldSendSecondReminder(lastActivity: Date): boolean {
    const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
    return hoursSinceActivity >= 24 && hoursSinceActivity < 72;
  }

  private shouldSendFinalReminder(lastActivity: Date): boolean {
    const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
    return hoursSinceActivity >= 72 && hoursSinceActivity < 168; // 7 days
  }
}
```

### 5. Frontend Cart Persistence

**Enhanced Cart Management**
```typescript
class PersistentCartManager {
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly syncIntervalMs = 30000; // 30 seconds

  constructor() {
    this.initializeCartSync();
    this.loadPersistedCart();
  }

  // Initialize automatic cart syncing
  private initializeCartSync() {
    this.syncInterval = setInterval(() => {
      this.syncCartToServer();
    }, this.syncIntervalMs);

    // Sync on page unload
    window.addEventListener('beforeunload', () => {
      this.syncCartToServer();
    });

    // Sync on page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.syncCartToServer();
      }
    });
  }

  // Load cart from server on page load
  private async loadPersistedCart() {
    try {
      const customerId = getUserId();
      const session = await api.getCartSession(customerId);

      if (session && session.items.length > 0) {
        // Restore cart items
        for (const item of session.items) {
          // Add to local cart state
          cartStore.addItem(item);
        }

        // Show recovery notification
        this.showCartRecoveredNotification(session.items.length);
      }
    } catch (error) {
      console.error('Failed to load persisted cart:', error);
    }
  }

  // Sync current cart to server
  private async syncCartToServer() {
    try {
      const customerId = getUserId();
      const cartItems = cartStore.getItems();

      if (cartItems.length > 0) {
        await api.updateCartSession(customerId, cartItems);
      }
    } catch (error) {
      console.error('Failed to sync cart:', error);
    }
  }

  // Recover cart from recovery token
  async recoverCart(recoveryToken: string) {
    try {
      const recoveredItems = await api.recoverCart(recoveryToken);

      if (recoveredItems && recoveredItems.length > 0) {
        // Clear current cart and add recovered items
        cartStore.clear();
        for (const item of recoveredItems) {
          cartStore.addItem(item);
        }

        this.showCartRecoverySuccessNotification(recoveredItems.length);
        return true;
      }
    } catch (error) {
      console.error('Cart recovery failed:', error);
      this.showCartRecoveryErrorNotification();
    }

    return false;
  }

  // Show notifications
  private showCartRecoveredNotification(itemCount: number) {
    // Implementation depends on your notification system
    showNotification({
      type: 'info',
      title: 'Cart Recovered',
      message: `We restored ${itemCount} item(s) from your previous session.`,
      duration: 5000
    });
  }

  private showCartRecoverySuccessNotification(itemCount: number) {
    showNotification({
      type: 'success',
      title: 'Cart Recovered!',
      message: `Successfully recovered ${itemCount} item(s) from your abandoned cart.`,
      duration: 5000
    });
  }

  private showCartRecoveryErrorNotification() {
    showNotification({
      type: 'error',
      title: 'Recovery Failed',
      message: 'Unable to recover your cart. The recovery link may have expired.',
      duration: 5000
    });
  }

  // Cleanup
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}
```

## Implementation Plan

### Phase 1: Database Schema Updates
- [ ] Add cart_sessions table
- [ ] Add cart_recovery table
- [ ] Extend cart_items with timestamps
- [ ] Add necessary indexes

### Phase 2: Backend Cart Persistence
- [ ] Implement CartSessionManager
- [ ] Implement CartRecoveryManager
- [ ] Update cart routes for session management
- [ ] Add recovery endpoints

### Phase 3: Email System
- [ ] Implement CartAbandonmentEmailService
- [ ] Create email templates
- [ ] Set up email scheduling job
- [ ] Configure email provider

### Phase 4: Frontend Integration
- [ ] Implement PersistentCartManager
- [ ] Add cart recovery UI components
- [ ] Update cart store for persistence
- [ ] Add recovery page/route

### Phase 5: Monitoring & Analytics
- [ ] Track cart abandonment rates
- [ ] Monitor recovery success rates
- [ ] Add cart analytics dashboard
- [ ] Set up email delivery tracking

## Benefits

✅ **Persistent Cart Storage**: Carts survive browser restarts and session expiration  
✅ **Cross-Device Sync**: Cart follows users across devices  
✅ **Abandonment Recovery**: Email campaigns to recover lost sales  
✅ **Better UX**: Seamless cart restoration  
✅ **Revenue Recovery**: Convert abandoned carts back to sales  
✅ **Analytics**: Track abandonment patterns and recovery effectiveness  

## Technical Considerations

### Performance
- Background jobs for email scheduling
- Efficient database queries with proper indexing
- Caching for frequently accessed cart data
- Rate limiting for recovery emails

### Security
- Secure recovery tokens with expiration
- Email validation and unsubscribe handling
- Rate limiting on recovery attempts
- GDPR compliance for data retention

### Scalability
- Database partitioning for large cart datasets
- Queue system for email processing
- CDN for static email assets
- Horizontal scaling support

This comprehensive cart abandonment recovery system will significantly reduce lost sales and improve user experience by ensuring carts are never lost and providing multiple recovery opportunities.