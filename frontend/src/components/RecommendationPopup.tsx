"use client";

import { useState } from "react";
import Link from "next/link";
import type { Recommendation } from "@/src/lib/types";

interface RecommendationPopupProps {
  recommendations: Recommendation[];
  isVisible: boolean;
  onClose: () => void;
  position: { top: number; left: number };
}

export default function RecommendationPopup({
  recommendations,
  isVisible,
  onClose,
  position,
}: RecommendationPopupProps) {
  if (!isVisible || recommendations.length === 0) return null;

  return (
    <div
      className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-80"
      style={{
        top: position.top,
        left: position.left,
      }}
      onMouseLeave={onClose}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Recommended for you</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          aria-label="Close recommendations"
        >
          ×
        </button>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {recommendations.map((rec) => (
          <Link
            key={rec.id}
            href={`/products/${rec.id}`}
            className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
            onClick={onClose}
          >
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden">
              {rec.image ? (
                <img
                  src={rec.image}
                  alt={rec.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://via.placeholder.com/48x48?text=No+Image";
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                  No Img
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {rec.name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {rec.category.name}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">
                  ${rec.price}
                </span>
                <div className="flex items-center">
                  <span className="text-xs text-yellow-500 mr-1">★</span>
                  <span className="text-xs text-gray-600">{rec.rating}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 text-center">
          Based on your interests
        </p>
      </div>
    </div>
  );
}