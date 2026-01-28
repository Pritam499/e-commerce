"use client";

import { useState, useEffect } from "react";
import { generateDiscountCode, getAdminStats } from "@/src/lib/api";
import type { AdminStats, DiscountCode } from "@/src/lib/types";

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [discountCode, setDiscountCode] = useState("");

  const loadStats = async () => {
    setLoading(true);
    try {
      const response = await getAdminStats();
      setStats(response.data);
    } catch (error) {
      setMessage(`Error loading stats: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleGenerateDiscount = async () => {
    setLoading(true);
    setMessage("");
    setDiscountCode("");
    try {
      const result = await generateDiscountCode();
      setDiscountCode(result.data?.code || "");
      setMessage("Discount code generated successfully!");
      loadStats();
    } catch (error) {
      setMessage(`Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Admin Dashboard
        </h1>

        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.includes("Error")
                ? "bg-red-50 text-red-800 border border-red-200"
                : "bg-green-50 text-green-800 border border-green-200"
            }`}
          >
            {message}
          </div>
        )}

        {discountCode && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800 font-semibold mb-2">
              Generated Discount Code:
            </p>
            <p className="text-2xl font-mono font-bold text-blue-900">
              {discountCode}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Generate Discount Code */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Generate Discount Code
            </h2>
            <p className="text-gray-600 mb-4 text-sm">
              Generate a discount code if the nth order condition is met (every
              3rd order).
            </p>
            <button
              onClick={handleGenerateDiscount}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Generating..." : "Generate Discount Code"}
            </button>
          </div>

          {/* Statistics */}
          {stats && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                Statistics
              </h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Items Purchased:</span>
                  <span className="font-semibold text-gray-900">
                    {stats.totalItemsPurchased || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Purchase Amount:</span>
                  <span className="font-semibold text-gray-900">
                    ${(stats.totalPurchaseAmount || 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Discount Amount:</span>
                  <span className="font-semibold text-green-600">
                    ${(stats.totalDiscountAmount || 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Discount Codes:</span>
                  <span className="font-semibold text-gray-900">
                    {stats.discountCodes?.length || 0}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Discount Codes Table */}
        {stats && stats.discountCodes && stats.discountCodes.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">
                Discount Codes
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Code
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Discount
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Order #
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {stats.discountCodes.map((code: DiscountCode) => (
                    <tr key={code.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <span className="font-mono font-semibold text-gray-900">
                          {code.code}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {code.discountPercentage}%
                      </td>
                      <td className="px-6 py-4">
                        {code.isUsed ? (
                          <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded">
                            Used
                          </span>
                        ) : code.isAvailable ? (
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                            Available
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs font-medium rounded">
                            Unavailable
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {code.orderNumberGenerated || "-"}
                      </td>
                      <td className="px-6 py-4 text-gray-700 text-sm">
                        {new Date(code.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
