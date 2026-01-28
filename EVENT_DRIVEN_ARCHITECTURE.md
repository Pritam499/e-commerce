# Event-Driven Architecture with Order Status Webhooks

## Problem Statement

Traditional synchronous systems suffer from tight coupling, poor scalability, and lack of real-time visibility. Key issues:

1. **Tight Coupling**: Direct service calls create dependencies and failure points
2. **No Real-time Updates**: External systems can't track order progress in real-time
3. **Poor Scalability**: Synchronous processing limits concurrent operations
4. **Limited Monitoring**: No centralized event tracking or debugging
5. **Webhook Reliability**: Missing secure, retry-capable webhook delivery

## Solution Architecture

### 1. Event Bus & Event-Driven Processing

**Event Bus Pattern**:
```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Services  │───▶│  Event Bus   │───▶│  Listeners  │
│             │    │              │    │             │
│ • Checkout  │    │ • Publish    │    │ • Jobs      │
│ • Cart      │    │ • Subscribe  │    │ • Webhooks  │
│ • Payments  │    │ • Monitor    │    │ • Analytics │
└─────────────┘    └──────────────┘    └─────────────┘
```

#### Event Types & Flow
```typescript
// Order Lifecycle Events
ORDER_CHECKOUT_INITIATED → JOB_ENQUEUED → ORDER_CREATED → JOB_COMPLETED
                           ↓                        ↓
                    PAYMENT_PROCESSING → ORDER_PAYMENT_COMPLETED
                           ↓                        ↓
                    INVENTORY_UPDATE → ORDER_CONFIRMATION_SENT → ORDER_COMPLETED

// Cart Events
CART_ITEM_ADDED → CART_ABANDONED → JOB_ENQUEUED → EMAIL_SENT
```

### 2. Event System Implementation

#### Event Bus Core
```typescript
class EventBus extends EventEmitter {
  // Publish events to all subscribers
  async publish(event: SystemEvent): Promise<void>

  // Subscribe with filtering and prioritization
  subscribe(eventType, handler, options): Unsubscriber

  // Monitor event flow
  getStats(): EventStatistics
  getEventHistory(limit): SystemEvent[]
}
```

#### Event Creation & Emission
```typescript
// Create typed events
const orderEvent = createEvent(EVENT_TYPES.ORDER_CREATED, {
  orderId: 'ord_123',
  customerId: 'user_456',
  total: '99.99'
}, {
  correlationId: 'checkout_789',
  userId: 'user_456',
  source: 'checkout-service'
});

// Emit event
await emitEvent(orderEvent);
```

### 3. Event-Driven Job Processing

#### Event-to-Job Mapping
```typescript
// Event handlers automatically enqueue jobs
eventBus.subscribe(EVENT_TYPES.ORDER_CHECKOUT_INITIATED, async (event) => {
  // Automatically enqueue order processing job
  await jobProducer.enqueueOrderCreation({
    checkoutInput: event.data.checkoutInput
  });

  // Emit job enqueued event
  await emitEvent(createEvent(EVENT_TYPES.JOB_ENQUEUED, {
    jobId: job.id,
    jobType: 'order-creation',
    queueName: 'order-processing'
  }));
});
```

#### Job Lifecycle Events
```typescript
// Job status events for monitoring
JOB_ENQUEUED → JOB_STARTED → JOB_COMPLETED | JOB_FAILED

// Worker emits status events
emitEvent(createEvent(EVENT_TYPES.JOB_STARTED, {
  jobId,
  workerId,
  startedAt: new Date()
}));
```

### 4. Order Status Webhooks

#### Webhook Registration
```typescript
// Register webhook endpoint
const webhookId = webhookManager.registerWebhook({
  url: "https://api.external.com/webhooks/orders",
  secret: "webhook-secret-key",
  events: [
    EVENT_TYPES.ORDER_CREATED,
    EVENT_TYPES.ORDER_PAYMENT_COMPLETED,
    EVENT_TYPES.ORDER_COMPLETED
  ],
  retryAttempts: 3,
  retryDelay: 5000,
  timeout: 30000
});
```

#### Secure Webhook Delivery
```typescript
// Automatic webhook delivery with signature verification
POST https://api.external.com/webhooks/orders
Headers:
  X-Webhook-Signature: hmac-sha256-signature
  X-Webhook-Event: order.created
  X-Webhook-ID: webhook_123
Body: {
  "id": "evt_456",
  "event": "order.created",
  "created": "2024-01-01T10:00:00Z",
  "data": {
    "orderId": "ord_123",
    "status": "created",
    "total": "99.99"
  }
}
```

#### Webhook Payload Types
```typescript
interface OrderStatusWebhook {
  orderId: string;
  orderNumber: number;
  customerId: string;
  status: string; // 'created', 'paid', 'shipped', 'completed'
  statusChangedAt: Date;
  total: string;
  currency: string;
  items: OrderItem[];
  paymentInfo?: PaymentDetails;
  metadata: Record<string, any>;
}

interface WorkerStatusWebhook {
  workerId: string;
  queueName: string;
  jobId: string;
  jobType: string;
  status: 'started' | 'completed' | 'failed';
  processingTime?: number;
  error?: string;
}
```

### 5. Event Monitoring & Analytics

#### Real-time Event Dashboard
```typescript
// Get live event statistics
const stats = eventBus.getStats();
// {
//   totalEvents: 1250,
//   subscriptionsByType: { 'order.created': 3, 'payment.completed': 2 },
//   recentEvents: [/* last 10 events */]
// }

// Get webhook delivery stats
const webhookStats = webhookManager.getStats();
// {
//   registeredWebhooks: 5,
//   deliveredWebhooks: 892,
//   failedWebhooks: 3,
//   queuedWebhooks: 12
// }
```

#### Event History & Debugging
```typescript
// Query event history for debugging
const recentEvents = eventBus.getEventHistory(50);

// Filter by correlation ID for request tracing
const requestEvents = recentEvents.filter(
  event => event.correlationId === 'checkout_123'
);
```

### 6. Integration Examples

#### Frontend Order Tracking
```typescript
// Subscribe to order status updates
const unsubscribe = eventBus.subscribe(
  EVENT_TYPES.ORDER_PAYMENT_COMPLETED,
  (event) => {
    if (event.userId === currentUser.id) {
      showNotification('Payment completed!', 'success');
      updateOrderStatus(event.data.orderId, 'paid');
    }
  }
);
```

#### External System Integration
```typescript
// Register webhook for order updates
webhookManager.registerWebhook({
  url: "https://crm.example.com/webhooks/orders",
  secret: process.env.CRM_WEBHOOK_SECRET,
  events: [EVENT_TYPES.ORDER_COMPLETED],
  retryAttempts: 5
});

// CRM system receives webhook and updates customer record
app.post('/webhooks/orders', (req, res) => {
  const { event, data } = req.body;

  if (event === 'order.completed') {
    updateCustomerLifetimeValue(data.customerId, data.total);
    triggerLoyaltyPoints(data.customerId, data.total);
  }

  res.sendStatus(200);
});
```

### 7. Error Handling & Resilience

#### Event Processing Resilience
```typescript
// Event handlers don't crash the system
eventBus.subscribe(EVENT_TYPE, async (event) => {
  try {
    await processEvent(event);
  } catch (error) {
    // Log error but don't stop other handlers
    logger.error('Event handler failed:', error);
  }
});
```

#### Webhook Delivery Reliability
```typescript
// Automatic retries with exponential backoff
class WebhookManager {
  async deliverWebhook(webhookEvent): Promise<void> {
    const maxRetries = webhookEvent.webhook.retryAttempts;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.sendWebhookRequest(webhookEvent);
        webhookEvent.status = 'delivered';
        break;
      } catch (error) {
        if (attempt === maxRetries) {
          webhookEvent.status = 'failed';
          webhookEvent.error = error.message;
        } else {
          // Exponential backoff
          await this.delay(Math.pow(2, attempt - 1) * 1000);
        }
      }
    }
  }
}
```

### 8. Performance & Scalability

#### Event Throughput Optimization
- **Async Processing**: Non-blocking event emission
- **Worker Pools**: Configurable concurrency per event type
- **Queue Buffering**: Redis-backed event queuing
- **Batch Processing**: Group similar events for efficiency

#### Monitoring Metrics
```typescript
const metrics = {
  eventsPerSecond: 0,
  averageProcessingTime: 0,
  webhookDeliveryRate: 0,
  errorRate: 0,
  queueDepth: 0
};
```

## Implementation Benefits

✅ **Decoupled Architecture**: Services communicate via events, not direct calls  
✅ **Real-time Updates**: Instant notifications for order status changes  
✅ **High Scalability**: Handle thousands of concurrent events  
✅ **Fault Tolerance**: Event processing failures don't crash the system  
✅ **Debugging Power**: Complete event history and correlation tracking  
✅ **External Integration**: Secure webhooks for third-party systems  
✅ **Monitoring**: Comprehensive visibility into system behavior  

## API Endpoints

### Webhook Management
```http
POST   /api/webhooks/register     # Register webhook
DELETE /api/webhooks/:id          # Unregister webhook
GET    /api/webhooks              # List webhooks
GET    /api/webhooks/stats        # Webhook statistics
```

### Event Monitoring
```http
GET    /api/events/stats          # Event statistics
GET    /api/events/history        # Event history
POST   /api/events/test           # Emit test event
```

### Order Status Webhooks
```http
POST   /api/webhooks/order-status     # Receive order updates
POST   /api/webhooks/worker-status    # Receive worker updates
POST   /api/webhooks/test             # Test webhook endpoint
```

## Testing Strategy

### Unit Tests
- Event emission and subscription
- Webhook signature verification
- Event handler execution
- Error handling scenarios

### Integration Tests
- End-to-end event flow
- Webhook delivery and retries
- Cross-service communication
- Failure recovery

### Load Tests
- High-volume event processing
- Concurrent webhook delivery
- System performance under stress
- Memory and resource usage

### Monitoring Tests
- Event statistics accuracy
- Webhook delivery tracking
- Error reporting completeness
- Performance metric collection

## Production Deployment

### Environment Configuration
```bash
# Event system
EVENT_HISTORY_SIZE=1000
EVENT_EMISSION_TIMEOUT=5000

# Webhooks
WEBHOOK_TIMEOUT=30000
WEBHOOK_MAX_RETRIES=5
WEBHOOK_RETRY_DELAY=5000

# Redis (for event queuing if needed)
REDIS_URL=redis://localhost:6379
REDIS_EVENT_CHANNEL=system-events
```

### Health Checks
```typescript
// Event system health
GET /health/events
{
  "status": "healthy",
  "eventBus": { "active": true, "subscribers": 15 },
  "webhooks": { "registered": 5, "healthy": true }
}
```

### Logging & Alerting
- **Event Processing Logs**: Track all event emissions and handling
- **Webhook Delivery Logs**: Monitor delivery success/failure
- **Performance Metrics**: Response times, throughput, error rates
- **Alerting**: Failed webhooks, high error rates, queue backups

## Conclusion

The event-driven architecture with order status webhooks provides:

🎯 **Real-time Visibility**: Track orders from initiation to completion  
🔄 **Loose Coupling**: Services communicate via events, not direct dependencies  
📈 **Scalability**: Handle massive concurrent operations  
🛡️ **Reliability**: Built-in retry mechanisms and error recovery  
🔍 **Observability**: Complete system visibility and debugging  
🌐 **Integration**: Secure webhooks for external system integration  
⚡ **Performance**: Asynchronous processing eliminates bottlenecks  

This architecture transforms the e-commerce system into a modern, scalable, and maintainable platform capable of handling enterprise-level traffic while providing excellent developer experience and operational visibility.