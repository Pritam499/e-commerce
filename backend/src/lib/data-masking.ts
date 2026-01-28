import crypto from "crypto";

// Sensitive data patterns to mask
const SENSITIVE_PATTERNS = [
  /password[_-]?hash?/i,
  /email/i,
  /name/i,
  /phone/i,
  /address/i,
  /credit[_-]?card/i,
  /ssn/i,
  /social[_-]?security/i,
  /birth[_-]?date/i,
  /token/i,
  /secret/i,
  /key/i,
  /auth/i,
];

// Fields that should be completely masked
const COMPLETE_MASK_FIELDS = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'secret',
  'key',
  'privateKey',
  'accessToken',
  'refreshToken',
  'authorization',
  'auth',
];

// Fields that should be partially masked (show first/last few chars)
const PARTIAL_MASK_FIELDS = [
  'email',
  'name',
  'phone',
  'address',
  'cardNumber',
  'accountNumber',
];

// Email masking: show first 2 chars + *** + domain
export function maskEmail(email: string): string {
  if (!email || typeof email !== 'string') return '***@***.***';

  const [local, domain] = email.split('@');
  if (!domain) return '***@***.***';

  const [domainName, tld] = domain.split('.');
  const maskedLocal = local.length > 2
    ? local.substring(0, 2) + '*'.repeat(Math.max(1, local.length - 3)) + local.slice(-1)
    : '*'.repeat(local.length);

  return `${maskedLocal}@${domainName.charAt(0)}***.${tld}`;
}

// Name masking: show first letter + ***
export function maskName(name: string): string {
  if (!name || typeof name !== 'string') return '***';
  if (name.length <= 2) return '*'.repeat(name.length);
  return name.charAt(0) + '*'.repeat(Math.max(1, name.length - 2)) + name.slice(-1);
}

// Phone masking: show area code + *** + last 4
export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '***-***-****';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '*'.repeat(digits.length);

  const last4 = digits.slice(-4);
  const prefix = digits.slice(0, -4);
  return `${'*'.repeat(Math.max(3, prefix.length - 3))}-${'*'.repeat(3)}-${last4}`;
}

// Credit card masking: show first 4 + *** + last 4
export function maskCreditCard(card: string): string {
  if (!card || typeof card !== 'string') return '****-****-****-****';
  const digits = card.replace(/\D/g, '');
  if (digits.length < 4) return '*'.repeat(digits.length);

  const first4 = digits.substring(0, 4);
  const last4 = digits.slice(-4);
  const middle = '*'.repeat(Math.max(8, digits.length - 8));

  return `${first4}-${middle}-${last4}`;
}

// Generic partial masking
export function maskPartial(value: string, showFirst = 2, showLast = 2): string {
  if (!value || typeof value !== 'string') return '***';
  if (value.length <= showFirst + showLast) return '*'.repeat(value.length);

  const first = value.substring(0, showFirst);
  const last = value.slice(-showLast);
  const middle = '*'.repeat(Math.max(1, value.length - showFirst - showLast));

  return `${first}${middle}${last}`;
}

// Complete masking (show nothing)
export function maskComplete(value: string): string {
  if (!value || typeof value !== 'string') return '***';
  return '*'.repeat(Math.min(value.length, 8));
}

// Deep mask object recursively
export function maskObject(obj: any, depth = 0): any {
  // Prevent infinite recursion
  if (depth > 10) return '[MAX_DEPTH_REACHED]';

  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return maskValue(obj);

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => maskObject(item, depth + 1));
  }

  // Handle objects
  const masked: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (COMPLETE_MASK_FIELDS.some(field => lowerKey.includes(field))) {
      masked[key] = maskComplete(String(value));
    } else if (PARTIAL_MASK_FIELDS.some(field => lowerKey.includes(field))) {
      if (lowerKey.includes('email')) {
        masked[key] = maskEmail(String(value));
      } else if (lowerKey.includes('name')) {
        masked[key] = maskName(String(value));
      } else if (lowerKey.includes('phone')) {
        masked[key] = maskPhone(String(value));
      } else if (lowerKey.includes('card')) {
        masked[key] = maskCreditCard(String(value));
      } else {
        masked[key] = maskPartial(String(value));
      }
    } else {
      masked[key] = maskObject(value, depth + 1);
    }
  }

  return masked;
}

// Mask a single value based on its type and content
export function maskValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;

  // Check if it looks like sensitive data
  if (value.includes('@') && value.includes('.')) {
    return maskEmail(value); // Email-like
  }

  if (/^\d{10,}$/.test(value.replace(/\D/g, ''))) {
    return maskPhone(value); // Phone-like
  }

  if (/^\d{13,19}$/.test(value.replace(/\D/g, ''))) {
    return maskCreditCard(value); // Credit card-like
  }

  return value;
}

// Safe logging function
export function safeLog(level: string, message: string, data?: any): void {
  const maskedData = data ? maskObject(data) : undefined;

  switch (level.toLowerCase()) {
    case 'error':
      console.error(`[${new Date().toISOString()}] ${message}`, maskedData);
      break;
    case 'warn':
      console.warn(`[${new Date().toISOString()}] ${message}`, maskedData);
      break;
    case 'info':
      console.info(`[${new Date().toISOString()}] ${message}`, maskedData);
      break;
    case 'debug':
      console.debug(`[${new Date().toISOString()}] ${message}`, maskedData);
      break;
    default:
      console.log(`[${new Date().toISOString()}] ${message}`, maskedData);
  }
}

// Safe error logging
export function safeErrorLog(error: Error, context?: string, additionalData?: any): void {
  const errorInfo = {
    name: error.name,
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : '[STACK_HIDDEN]',
    context,
    ...maskObject(additionalData || {}),
  };

  safeLog('error', `Error: ${error.message}`, errorInfo);
}