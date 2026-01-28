"use client";

import { useEffect } from "react";
import { wsClient } from "@/src/lib/websocket";
import { logger } from "@/src/lib/logger";

export default function WebSocketInitializer() {
  useEffect(() => {
    // Connect to WebSocket
    wsClient.connect();

    // Set up event handlers
    wsClient.onConnect(() => {
      logger.info('WebSocket connected');
    });

    wsClient.onDisconnect(() => {
      logger.info('WebSocket disconnected');
    });

    wsClient.onError((error) => {
      logger.error('WebSocket error', error);
    });

    // Subscribe to general topics
    wsClient.subscribe(['inventory']);

    // Authenticate if we have a token (this would be set after login)
    const token = localStorage.getItem('accessToken');
    if (token) {
      // Extract user ID from token (simplified - in real app you'd decode JWT)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.id) {
          wsClient.authenticate(payload.id);
          wsClient.subscribe([`user:${payload.id}`]);
        }
      } catch (error) {
        logger.error('Failed to authenticate WebSocket', error);
      }
    }

    // Cleanup on unmount
    return () => {
      wsClient.disconnect();
    };
  }, []);

  // This component doesn't render anything
  return null;
}