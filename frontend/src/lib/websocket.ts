import { logger } from './logger';

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
  | { type: 'welcome'; clientId: string; timestamp: number }
  | { type: 'subscribed'; topics: string[]; timestamp: number }
  | { type: 'unsubscribed'; topics: string[]; timestamp: number }
  | { type: 'error'; message: string };

type MessageHandler = (message: WebSocketMessage) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: Event) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private messageHandlers = new Map<string, MessageHandler[]>();
  private connectionHandlers: ConnectionHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private disconnectionHandlers: ConnectionHandler[] = [];

  constructor(private url: string) {}

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);

      logger.info('WebSocket connecting...', { url: this.url });
    } catch (error) {
      logger.error('WebSocket connection failed', { error: error.message });
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    logger.info('WebSocket disconnected');
  }

  // Subscribe to topics
  subscribe(topics: string[]): void {
    this.sendMessage({
      type: 'subscribe',
      topics,
    });
  }

  // Unsubscribe from topics
  unsubscribe(topics: string[]): void {
    this.sendMessage({
      type: 'unsubscribe',
      topics,
    });
  }

  // Send a message
  private sendMessage(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      logger.warn('WebSocket not connected, message not sent', { message });
    }
  }

  // Authenticate with user ID
  authenticate(userId: string): void {
    // Store user ID for reconnection
    localStorage.setItem('ws_user_id', userId);

    // Send auth message if connected
    if (this.clientId) {
      // Auth happens automatically on the server side via JWT in HTTP requests
      // But we can send additional auth info if needed
      logger.info('WebSocket authenticated', { userId });
    }
  }

  // Event handlers
  onMessage(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  onConnect(handler: ConnectionHandler): void {
    this.connectionHandlers.push(handler);
  }

  onDisconnect(handler: ConnectionHandler): void {
    this.disconnectionHandlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  // Remove event handlers
  offMessage(type: string, handler?: MessageHandler): void {
    if (!this.messageHandlers.has(type)) return;

    if (handler) {
      const handlers = this.messageHandlers.get(type)!;
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    } else {
      this.messageHandlers.delete(type);
    }
  }

  offConnect(handler: ConnectionHandler): void {
    const index = this.connectionHandlers.indexOf(handler);
    if (index > -1) {
      this.connectionHandlers.splice(index, 1);
    }
  }

  offDisconnect(handler: ConnectionHandler): void {
    const index = this.disconnectionHandlers.indexOf(handler);
    if (index > -1) {
      this.disconnectionHandlers.splice(index, 1);
    }
  }

  offError(handler: ErrorHandler): void {
    const index = this.errorHandlers.indexOf(handler);
    if (index > -1) {
      this.errorHandlers.splice(index, 1);
    }
  }

  private handleOpen(): void {
    logger.info('WebSocket connected');
    this.reconnectAttempts = 0;

    // Start heartbeat
    this.startHeartbeat();

    // Notify connection handlers
    this.connectionHandlers.forEach(handler => handler());

    // Re-authenticate if we have a user ID
    const userId = localStorage.getItem('ws_user_id');
    if (userId) {
      this.authenticate(userId);
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);

      // Handle system messages
      if (message.type === 'welcome') {
        this.clientId = message.clientId;
        logger.info('WebSocket welcome received', { clientId: this.clientId });
        return;
      }

      if (message.type === 'pong') {
        // Heartbeat response
        return;
      }

      // Dispatch to message handlers
      const handlers = this.messageHandlers.get(message.type);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            logger.error('WebSocket message handler error', {
              type: message.type,
              error: error.message
            });
          }
        });
      }

    } catch (error) {
      logger.error('WebSocket message parsing error', { error: error.message });
    }
  }

  private handleClose(event: CloseEvent): void {
    logger.info('WebSocket closed', { code: event.code, reason: event.reason });

    this.stopHeartbeat();

    // Notify disconnection handlers
    this.disconnectionHandlers.forEach(handler => handler());

    // Attempt reconnection unless it was a clean close
    if (event.code !== 1000) {
      this.scheduleReconnect();
    }
  }

  private handleError(event: Event): void {
    logger.error('WebSocket error', event);

    // Notify error handlers
    this.errorHandlers.forEach(handler => handler(event));
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: 'ping', timestamp: Date.now() });
      }
    }, 30000); // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    logger.info('Scheduling WebSocket reconnection', {
      attempt: this.reconnectAttempts,
      delay
    });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  // Get connection status
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get clientId(): string | null {
    return this.clientId;
  }
}

// Global WebSocket client instance
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || `ws://localhost:3001/ws`;
export const wsClient = new WebSocketClient(WS_URL);

// Auto-connect on client-side
if (typeof window !== 'undefined') {
  wsClient.connect();

  // Reconnect on page visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !wsClient.isConnected) {
      wsClient.connect();
    }
  });
}