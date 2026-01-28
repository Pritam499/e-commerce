import { EventEmitter } from 'events';
import { SystemEvent, EVENT_TYPES, EventHandler, EventSubscription } from './types';
import { logger } from '../../utils/logger';

export class EventBus extends EventEmitter {
  private subscriptions: Map<EVENT_TYPES, EventSubscription[]> = new Map();
  private eventHistory: SystemEvent[] = [];
  private maxHistorySize = 1000;

  constructor() {
    super();
    this.setMaxListeners(100); // Allow more listeners
  }

  /**
   * Publish an event to all subscribers
   */
  async publish<T extends SystemEvent>(event: T): Promise<void> {
    try {
      // Add to history for debugging/auditing
      this.addToHistory(event);

      logger.info(`📢 Event published: ${event.type}`, {
        eventId: event.id,
        correlationId: event.correlationId,
        userId: event.userId,
        timestamp: event.timestamp
      });

      // Emit to EventEmitter for immediate handling
      this.emit(event.type, event);

      // Get subscribers for this event type
      const subscribers = this.subscriptions.get(event.type) || [];

      // Sort by priority (higher priority first)
      const sortedSubscribers = subscribers.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      // Execute all handlers asynchronously
      const handlerPromises = sortedSubscribers
        .filter(sub => !sub.filter || sub.filter(event))
        .map(async (sub) => {
          try {
            await sub.handler(event);
          } catch (error) {
            logger.error(`❌ Event handler failed for ${event.type}:`, error);
            // Don't let one failing handler stop others
          }
        });

      // Wait for all handlers to complete
      await Promise.allSettled(handlerPromises);

    } catch (error) {
      logger.error(`💥 Failed to publish event ${event.type}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to events with filtering and prioritization
   */
  subscribe(
    eventType: EVENT_TYPES,
    handler: EventHandler,
    options: {
      priority?: number;
      filter?: (event: SystemEvent) => boolean;
    } = {}
  ): () => void {
    const subscription: EventSubscription = {
      eventType,
      handler,
      priority: options.priority || 0,
      filter: options.filter
    };

    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, []);
    }

    this.subscriptions.get(eventType)!.push(subscription);

    logger.info(`👂 Subscribed to event: ${eventType}`, {
      totalSubscribers: this.subscriptions.get(eventType)!.length,
      priority: subscription.priority
    });

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(eventType);
      if (subs) {
        const index = subs.indexOf(subscription);
        if (index > -1) {
          subs.splice(index, 1);
          logger.info(`🔕 Unsubscribed from event: ${eventType}`);
        }
      }
    };
  }

  /**
   * Subscribe to multiple event types at once
   */
  subscribeMultiple(
    eventTypes: EVENT_TYPES[],
    handler: EventHandler,
    options: {
      priority?: number;
      filter?: (event: SystemEvent) => boolean;
    } = {}
  ): () => void {
    const unsubscribers = eventTypes.map(eventType =>
      this.subscribe(eventType, handler, options)
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }

  /**
   * Get subscribers for an event type
   */
  getSubscribers(eventType: EVENT_TYPES): EventSubscription[] {
    return this.subscriptions.get(eventType) || [];
  }

  /**
   * Get all subscriptions
   */
  getAllSubscriptions(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [eventType, subs] of this.subscriptions) {
      result[eventType] = subs.length;
    }
    return result;
  }

  /**
   * Get recent event history
   */
  getEventHistory(limit: number = 100): SystemEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get event statistics
   */
  getStats(): {
    totalEvents: number;
    subscriptionsByType: Record<string, number>;
    recentEvents: SystemEvent[];
  } {
    return {
      totalEvents: this.eventHistory.length,
      subscriptionsByType: this.getAllSubscriptions(),
      recentEvents: this.getEventHistory(10)
    };
  }

  private addToHistory(event: SystemEvent): void {
    this.eventHistory.push(event);

    // Maintain max history size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }
}

// Global event bus instance
export const eventBus = new EventBus();

// Helper function to create events
export function createEvent<T extends SystemEvent>(
  type: T['type'],
  data: T['data'],
  metadata: {
    source?: string;
    correlationId?: string;
    userId?: string;
    sessionId?: string;
    customMetadata?: Record<string, any>;
  } = {}
): T {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    timestamp: new Date(),
    source: metadata.source || 'system',
    correlationId: metadata.correlationId,
    userId: metadata.userId,
    sessionId: metadata.sessionId,
    metadata: metadata.customMetadata,
    data
  } as T;
}

// Export convenience functions
export const emitEvent = eventBus.publish.bind(eventBus);
export const subscribeToEvent = eventBus.subscribe.bind(eventBus);
export const subscribeToEvents = eventBus.subscribeMultiple.bind(eventBus);