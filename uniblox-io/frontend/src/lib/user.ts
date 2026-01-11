// User session management
const USER_ID_KEY = "unishop_user_id";

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Get user ID as UUID string
 */
export function getUserId(): string {
  if (typeof window === "undefined") {
    return ""; // Default for SSR
  }

  let userId = localStorage.getItem(USER_ID_KEY);
  
  if (!userId) {
    // Generate UUID
    userId = generateUUID();
    localStorage.setItem(USER_ID_KEY, userId);
  }

  return userId;
}

/**
 * Get user ID as UUID string (alias for getUserId)
 */
export function getUserIdUUID(): string {
  return getUserId();
}

export function clearUserId() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(USER_ID_KEY);
  }
}
