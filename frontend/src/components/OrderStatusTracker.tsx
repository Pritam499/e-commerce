"use client";

import { useState, useEffect } from "react";
import { wsClient, OrderStatusUpdateMessage } from "@/src/lib/websocket";
import { logger } from "@/src/lib/logger";

interface OrderStatusTrackerProps {
  orderId: string;
  initialStatus: string;
  onStatusChange?: (newStatus: string, previousStatus: string) => void;
}

const ORDER_STATUSES = [
  { key: 'pending', label: 'Order Placed', color: 'bg-yellow-100 text-yellow-800', description: 'Your order has been received and is being processed.' },
  { key: 'processing', label: 'Processing', color: 'bg-blue-100 text-blue-800', description: 'We\'re preparing your order for shipment.' },
  { key: 'shipped', label: 'Shipped', color: 'bg-indigo-100 text-indigo-800', description: 'Your order has been shipped and is on its way.' },
  { key: 'delivered', label: 'Delivered', color: 'bg-green-100 text-green-800', description: 'Your order has been delivered successfully.' },
  { key: 'cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-800', description: 'This order has been cancelled.' },
  { key: 'returned', label: 'Returned', color: 'bg-orange-100 text-orange-800', description: 'Items from this order have been returned.' },
  { key: 'failed', label: 'Failed', color: 'bg-red-100 text-red-800', description: 'This order could not be completed.' },
];

export default function OrderStatusTracker({
  orderId,
  initialStatus,
  onStatusChange,
}: OrderStatusTrackerProps) {
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [previousStatus, setPreviousStatus] = useState(initialStatus);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [isRealTime, setIsRealTime] = useState(false);

  useEffect(() => {
    const handleOrderStatusUpdate = (message: OrderStatusUpdateMessage) => {
      if (message.orderId === orderId) {
        logger.info('Received order status update', {
          orderId,
          previousStatus: message.previousStatus,
          newStatus: message.newStatus,
        });

        setPreviousStatus(message.previousStatus);
        setCurrentStatus(message.newStatus);
        setLastUpdate(message.timestamp);
        setIsRealTime(true);

        if (onStatusChange) {
          onStatusChange(message.newStatus, message.previousStatus);
        }

        // Reset real-time indicator after 10 seconds
        setTimeout(() => setIsRealTime(false), 10000);
      }
    };

    // Subscribe to order-specific updates
    wsClient.subscribe([`order:${orderId}`]);

    wsClient.onMessage('order_status_update', handleOrderStatusUpdate);

    return () => {
      wsClient.offMessage('order_status_update', handleOrderStatusUpdate);
    };
  }, [orderId, onStatusChange]);

  const getStatusInfo = (status: string) => {
    return ORDER_STATUSES.find(s => s.key === status) || ORDER_STATUSES[0];
  };

  const getStatusIndex = (status: string) => {
    return ORDER_STATUSES.findIndex(s => s.key === status);
  };

  const currentStatusInfo = getStatusInfo(currentStatus);
  const currentIndex = getStatusIndex(currentStatus);
  const previousIndex = getStatusIndex(previousStatus);

  const timeAgo = lastUpdate ? getTimeAgo(lastUpdate) : null;

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${currentStatusInfo.color}`}>
            {currentStatusInfo.label}
          </div>
          {isRealTime && (
            <div className="flex items-center text-green-600">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div>
              <span className="text-sm font-medium">Live Update</span>
            </div>
          )}
        </div>
        {timeAgo && (
          <span className="text-sm text-gray-500">Updated {timeAgo}</span>
        )}
      </div>

      {/* Status Description */}
      <p className="text-gray-600">{currentStatusInfo.description}</p>

      {/* Status Progress */}
      <div className="space-y-2">
        {ORDER_STATUSES.map((status, index) => {
          const isCompleted = index <= currentIndex;
          const isCurrent = index === currentIndex;
          const wasPrevious = index === previousIndex && previousStatus !== currentStatus;

          return (
            <div key={status.key} className="flex items-center space-x-3">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                isCompleted
                  ? 'bg-green-500'
                  : isCurrent
                    ? 'bg-blue-500 animate-pulse'
                    : 'bg-gray-300'
              }`}>
                {isCompleted && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <div className={`text-sm font-medium ${
                  isCompleted ? 'text-green-700' :
                  isCurrent ? 'text-blue-700' :
                  'text-gray-500'
                }`}>
                  {status.label}
                  {wasPrevious && (
                    <span className="ml-2 text-xs text-orange-600">(Previous)</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {status.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Status Change Notification */}
      {previousStatus !== currentStatus && lastUpdate && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                Order Status Updated
              </h3>
              <div className="mt-1 text-sm text-blue-700">
                Changed from <span className="font-medium">{getStatusInfo(previousStatus).label}</span> to{' '}
                <span className="font-medium">{getStatusInfo(currentStatus).label}</span>
              </div>
            </div>
          </div>
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

  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;

  return new Date(timestamp).toLocaleDateString();
}