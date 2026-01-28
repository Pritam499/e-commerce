import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from './logger';
import { maskObject } from './data-masking';

export interface WebSocketClient {
  id: string;
  ws: WebSocket;
  userId?: string;
  ip: string;
  subscribedTopics: Set<string>;
  lastActivity: number;
  isAlive: boolean;
}

export interface InventoryUpdateMessage {
  type: 'inventory_update';
  productId: string;
  previousStock: number;
  newStock: number;
  reason: 'order_placed' | 'order_cancelled' | 'item_returned' | 'stock_adjustment' | 'restock';
  orderId?: string;
  userId?: string;
  timestamp: number;
}

export interface OrderStatusUpdateMessage {
  type: 'order_status_update';
  orderId: string;
  previousStatus: string;
  newStatus: string;
  userId: string;
  timestamp: number;
}

export interface CartUpdateMessage {
  type: 'cart_update';
  userId: string;
  action: 'add' | 'remove' | 'update' | 'clear';
  productId?: string;
  quantity?: number;
  timestamp: number;
}

export type WebSocketMessage =
  | InventoryUpdateMessage
  | OrderStatusUpdateMessage
  | CartUpdateMessage
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'subscribe'; topics: string[] }
  | { type: 'unsubscribe'; topics: string[] }
  | { type: 'error'; message: string };

export class WebSocketService {
  private wss: WebSocket.Server | null = null;
  private clients = new Map<string, WebSocketClient>();
  private topicSubscriptions = new Map<string, Set<string>>(); // topic -> clientIds

  constructor() {
    // Cleanup inactive clients every 30 seconds
    setInterval(() => this.cleanupInactiveClients(), 30000);

    // Ping clients every 60 seconds to check connectivity
    setInterval(() => this.pingClients(), 60000);
  }

  initialize(wss: WebSocket.Server): void {
    this.wss = wss;

    wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.handleConnection(ws, request);
    });

    logger.info('WebSocket service initialized');
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const clientId = this.generateClientId();
    const ip = this.getClientIP(request);

    const client: WebSocketClient = {
      id: clientId,
      ws,
      ip,
      subscribedTopics: new Set(),
      lastActivity: Date.now(),
      isAlive: true,
    };

    this.clients.set(clientId, client);

    logger.info('WebSocket client connected', { clientId, ip });

    // Handle messages
    ws.on('message', (data: Buffer) => {
      this.handleMessage(client, data);
    });

    // Handle disconnection
    ws.on('close', () => {
      this.handleDisconnection(client);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket client error', { clientId, error: error.message });
      this.handleDisconnection(client);
    });

    // Send welcome message
    this.sendToClient(client, {
      type: 'welcome',
      clientId,
      timestamp: Date.now(),
    });
  }

  private handleMessage(client: WebSocketClient, data: Buffer): void {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());

      client.lastActivity = Date.now();

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(client, message.topics);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(client, message.topics);
          break;
        case 'ping':
          this.sendToClient(client, { type: 'pong', timestamp: Date.now() });
          break;
        case 'pong':
          client.isAlive = true;
          break;
        default:
          logger.warn('Unknown WebSocket message type', {
            clientId: client.id,
            type: (message as any).type
          });
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message', {
        clientId: client.id,
        error: error.message
      });
      this.sendToClient(client, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  }

  private handleSubscribe(client: WebSocketClient, topics: string[]): void {
    topics.forEach(topic => {
      client.subscribedTopics.add(topic);

      // Add to topic subscriptions
      if (!this.topicSubscriptions.has(topic)) {
        this.topicSubscriptions.set(topic, new Set());
      }
      this.topicSubscriptions.get(topic)!.add(client.id);

      logger.debug('Client subscribed to topic', { clientId: client.id, topic });
    });

    this.sendToClient(client, {
      type: 'subscribed',
      topics,
      timestamp: Date.now(),
    });
  }

  private handleUnsubscribe(client: WebSocketClient, topics: string[]): void {
    topics.forEach(topic => {
      client.subscribedTopics.delete(topic);

      // Remove from topic subscriptions
      const topicClients = this.topicSubscriptions.get(topic);
      if (topicClients) {
        topicClients.delete(client.id);
        if (topicClients.size === 0) {
          this.topicSubscriptions.delete(topic);
        }
      }

      logger.debug('Client unsubscribed from topic', { clientId: client.id, topic });
    });

    this.sendToClient(client, {
      type: 'unsubscribed',
      topics,
      timestamp: Date.now(),
    });
  }

  private handleDisconnection(client: WebSocketClient): void {
    logger.info('WebSocket client disconnected', { clientId: client.id });

    // Remove from all topic subscriptions
    client.subscribedTopics.forEach(topic => {
      const topicClients = this.topicSubscriptions.get(topic);
      if (topicClients) {
        topicClients.delete(client.id);
        if (topicClients.size === 0) {
          this.topicSubscriptions.delete(topic);
        }
      }
    });

    this.clients.delete(client.id);
  }

  // Public methods for sending messages
  broadcast(message: WebSocketMessage, filter?: (client: WebSocketClient) => boolean): void {
    const maskedMessage = maskObject(message);
    let sentCount = 0;

    for (const client of this.clients.values()) {
      if (!filter || filter(client)) {
        this.sendToClient(client, maskedMessage);
        sentCount++;
      }
    }

    logger.debug('Message broadcasted', {
      type: message.type,
      recipients: sentCount
    });
  }

  broadcastToTopic(topic: string, message: WebSocketMessage): void {
    const topicClients = this.topicSubscriptions.get(topic);
    if (!topicClients || topicClients.size === 0) {
      return;
    }

    const maskedMessage = maskObject(message);
    let sentCount = 0;

    for (const clientId of topicClients) {
      const client = this.clients.get(clientId);
      if (client) {
        this.sendToClient(client, maskedMessage);
        sentCount++;
      }
    }

    logger.debug('Message broadcasted to topic', {
      topic,
      type: message.type,
      recipients: sentCount
    });
  }

  sendToUser(userId: string, message: WebSocketMessage): void {
    const maskedMessage = maskObject(message);
    let sentCount = 0;

    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        this.sendToClient(client, maskedMessage);
        sentCount++;
      }
    }

    if (sentCount > 0) {
      logger.debug('Message sent to user', {
        userId,
        type: message.type,
        clients: sentCount
      });
    }
  }

  sendToClient(client: WebSocketClient, message: WebSocketMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Failed to send message to client', {
          clientId: client.id,
          error: error.message
        });
      }
    }
  }

  // Authentication
  authenticateClient(clientId: string, userId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.userId = userId;
      logger.debug('Client authenticated', { clientId, userId });
    }
  }

  // Inventory update broadcasts
  broadcastInventoryUpdate(update: Omit<InventoryUpdateMessage, 'type' | 'timestamp'>): void {
    const message: InventoryUpdateMessage = {
      type: 'inventory_update',
      ...update,
      timestamp: Date.now(),
    };

    // Broadcast to all clients subscribed to inventory updates
    this.broadcastToTopic('inventory', message);

    // Also broadcast to product-specific topic
    this.broadcastToTopic(`product:${update.productId}`, message);

    logger.info('Inventory update broadcasted', {
      productId: update.productId,
      previousStock: update.previousStock,
      newStock: update.newStock,
      reason: update.reason,
    });
  }

  // Order status updates
  broadcastOrderStatusUpdate(update: Omit<OrderStatusUpdateMessage, 'type' | 'timestamp'>): void {
    const message: OrderStatusUpdateMessage = {
      type: 'order_status_update',
      ...update,
      timestamp: Date.now(),
    };

    // Broadcast to user-specific topic
    this.broadcastToTopic(`user:${update.userId}`, message);

    // Broadcast to order-specific topic
    this.broadcastToTopic(`order:${update.orderId}`, message);

    logger.info('Order status update broadcasted', {
      orderId: update.orderId,
      userId: update.userId,
      previousStatus: update.previousStatus,
      newStatus: update.newStatus,
    });
  }

  // Cart updates
  broadcastCartUpdate(update: Omit<CartUpdateMessage, 'type' | 'timestamp'>): void {
    const message: CartUpdateMessage = {
      type: 'cart_update',
      ...update,
      timestamp: Date.now(),
    };

    // Broadcast to user-specific topic
    this.broadcastToTopic(`user:${update.userId}`, message);

    logger.debug('Cart update broadcasted', {
      userId: update.userId,
      action: update.action,
      productId: update.productId,
    });
  }

  // Maintenance methods
  private cleanupInactiveClients(): void {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    let cleanedCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (now - client.lastActivity > timeout) {
        client.ws.close();
        this.clients.delete(clientId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up inactive clients', { count: cleanedCount });
    }
  }

  private pingClients(): void {
    for (const client of this.clients.values()) {
      if (!client.isAlive) {
        client.ws.close();
        continue;
      }

      client.isAlive = false;
      this.sendToClient(client, { type: 'ping', timestamp: Date.now() });
    }
  }

  private generateClientId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getClientIP(request: IncomingMessage): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (request.headers['x-real-ip'] as string) ||
      (request.socket.remoteAddress || 'unknown')
    );
  }

  // Statistics
  getStats(): {
    totalClients: number;
    authenticatedClients: number;
    topics: Record<string, number>;
    uptime: number;
  } {
    const authenticatedClients = Array.from(this.clients.values())
      .filter(client => client.userId).length;

    const topics: Record<string, number> = {};
    for (const [topic, clients] of this.topicSubscriptions.entries()) {
      topics[topic] = clients.size;
    }

    return {
      totalClients: this.clients.size,
      authenticatedClients,
      topics,
      uptime: process.uptime(),
    };
  }
}

// Global WebSocket service instance
export const wsService = new WebSocketService();