"use client";

import { useState, useEffect } from "react";
import { wsClient, InventoryUpdateMessage } from "@/src/lib/websocket";
import { logger } from "@/src/lib/logger";

interface ProductInventoryProps {
  productId: string;
  initialStock: number;
  onStockChange?: (newStock: number, previousStock: number, reason: string) => void;
  showRealTimeIndicator?: boolean;
}

export default function ProductInventory({
  productId,
  initialStock,
  onStockChange,
  showRealTimeIndicator = true,
}: ProductInventoryProps) {
  const [currentStock, setCurrentStock] = useState(initialStock);
  const [previousStock, setPreviousStock] = useState(initialStock);
  const [lastUpdateReason, setLastUpdateReason] = useState<string | null>(null);
  const [isRealTime, setIsRealTime] = useState(false);
  const [updateTimestamp, setUpdateTimestamp] = useState<number | null>(null);

  useEffect(() => {
    // Subscribe to inventory updates for this product
    const handleInventoryUpdate = (message: InventoryUpdateMessage) => {
      if (message.productId === productId) {
        logger.info('Received inventory update', {
          productId,
          previousStock: message.previousStock,
          newStock: message.newStock,
          reason: message.reason,
        });

        setPreviousStock(message.previousStock);
        setCurrentStock(message.newStock);
        setLastUpdateReason(message.reason);
        setUpdateTimestamp(message.timestamp);
        setIsRealTime(true);

        // Notify parent component
        if (onStockChange) {
          onStockChange(message.newStock, message.previousStock, message.reason);
        }

        // Reset real-time indicator after 5 seconds
        setTimeout(() => setIsRealTime(false), 5000);
      }
    };

    // Subscribe to product-specific updates
    wsClient.subscribe([`product:${productId}`, 'inventory']);

    // Listen for inventory update messages
    wsClient.onMessage('inventory_update', handleInventoryUpdate);

    // Cleanup
    return () => {
      wsClient.offMessage('inventory_update', handleInventoryUpdate);
    };
  }, [productId, onStockChange]);

  const getStockStatus = () => {
    if (currentStock === 0) return { status: 'out-of-stock', color: 'text-red-600', bgColor: 'bg-red-50' };
    if (currentStock <= 5) return { status: 'low-stock', color: 'text-orange-600', bgColor: 'bg-orange-50' };
    return { status: 'in-stock', color: 'text-green-600', bgColor: 'bg-green-50' };
  };

  const getReasonText = (reason: string) => {
    switch (reason) {
      case 'order_placed': return 'Order placed';
      case 'order_cancelled': return 'Order cancelled';
      case 'item_returned': return 'Item returned';
      case 'stock_adjustment': return 'Stock adjusted';
      case 'restock': return 'Restocked';
      default: return reason;
    }
  };

  const stockStatus = getStockStatus();
  const stockChange = currentStock - previousStock;
  const timeAgo = updateTimestamp ? getTimeAgo(updateTimestamp) : null;

  return (
    <div className="space-y-2">
      <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${stockStatus.bgColor} ${stockStatus.color}`}>
        <span className="mr-2">
          {currentStock === 0 ? 'Out of Stock' :
           currentStock <= 5 ? `Only ${currentStock} left` :
           `${currentStock} in stock`}
        </span>

        {showRealTimeIndicator && isRealTime && (
          <div className="flex items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div>
            <span className="text-xs">Live</span>
          </div>
        )}
      </div>

      {stockChange !== 0 && updateTimestamp && (
        <div className="text-sm text-gray-600 space-y-1">
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${stockChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {stockChange > 0 ? '+' : ''}{stockChange} {lastUpdateReason && getReasonText(lastUpdateReason)}
            </span>
            {timeAgo && (
              <span className="text-gray-400">• {timeAgo}</span>
            )}
          </div>

          {lastUpdateReason && (
            <div className="text-xs text-gray-500">
              Updated via real-time sync
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;

  return new Date(timestamp).toLocaleDateString();
}