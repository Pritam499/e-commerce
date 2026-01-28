import crypto from "crypto";

// Encryption configuration
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "your-32-character-encryption-key!!";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// Ensure key is 32 bytes
const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);

// Sensitive fields that should be encrypted
export const SENSITIVE_FIELDS = [
  'email',
  'name',
  'phone',
  'address',
  'cardNumber',
  'cardExpiry',
  'cardCvv',
  'billingAddress',
  'shippingAddress',
  'taxId',
  'socialSecurityNumber',
  'dateOfBirth',
  'emergencyContact',
  'medicalInfo',
];

// Encrypt a value
export function encrypt(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid input for encryption');
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipher(ALGORITHM, key);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get the auth tag
    const tag = (cipher as any).getAuthTag();

    // Return format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  } catch (error) {
    throw new Error('Encryption failed');
  }
}

// Decrypt a value
export function decrypt(encryptedText: string): string {
  if (!encryptedText || typeof encryptedText !== 'string') {
    throw new Error('Invalid input for decryption');
  }

  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipher(ALGORITHM, key);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed');
  }
}

// Check if a field should be encrypted
export function shouldEncrypt(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.some(field => lowerField.includes(field));
}

// Encrypt object fields recursively
export function encryptObject(obj: any, depth = 0): any {
  // Prevent infinite recursion
  if (depth > 5) return obj;

  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => encryptObject(item, depth + 1));
  }

  // Handle objects
  const encrypted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (shouldEncrypt(key) && typeof value === 'string') {
      try {
        encrypted[key] = encrypt(value);
      } catch (error) {
        // If encryption fails, store as-is but log the error
        console.error(`Failed to encrypt field ${key}:`, error);
        encrypted[key] = value;
      }
    } else {
      encrypted[key] = encryptObject(value, depth + 1);
    }
  }

  return encrypted;
}

// Decrypt object fields recursively
export function decryptObject(obj: any, depth = 0): any {
  // Prevent infinite recursion
  if (depth > 5) return obj;

  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => decryptObject(item, depth + 1));
  }

  // Handle objects
  const decrypted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (shouldEncrypt(key) && typeof value === 'string') {
      try {
        // Check if it looks like encrypted data (has 3 parts separated by :)
        if (value.split(':').length === 3) {
          decrypted[key] = decrypt(value);
        } else {
          // Not encrypted, return as-is
          decrypted[key] = value;
        }
      } catch (error) {
        // If decryption fails, return as-is
        console.error(`Failed to decrypt field ${key}:`, error);
        decrypted[key] = value;
      }
    } else {
      decrypted[key] = decryptObject(value, depth + 1);
    }
  }

  return decrypted;
}

// Hash a value (one-way, for passwords)
export function hashValue(value: string, saltRounds = 12): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Invalid input for hashing');
  }

  // Use scrypt for better security than bcrypt for this use case
  const salt = crypto.randomBytes(32);
  const hash = crypto.scryptSync(value, salt, 64);

  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

// Verify a hashed value
export function verifyHash(value: string, hashedValue: string): boolean {
  try {
    const [saltHex, hashHex] = hashedValue.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const originalHash = Buffer.from(hashHex, 'hex');

    const testHash = crypto.scryptSync(value, salt, 64);

    return crypto.timingSafeEqual(originalHash, testHash);
  } catch (error) {
    return false;
  }
}

// Generate a secure random token
export function generateSecureToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// GDPR-compliant data anonymization
export function anonymizeData(data: any): any {
  if (!data) return data;

  const anonymized = { ...data };

  // Remove or anonymize personal data
  const fieldsToRemove = ['email', 'name', 'phone', 'address', 'ipAddress'];
  const fieldsToAnonymize = ['userId', 'customerId'];

  fieldsToRemove.forEach(field => {
    if (anonymized[field]) {
      delete anonymized[field];
    }
  });

  fieldsToAnonymize.forEach(field => {
    if (anonymized[field]) {
      anonymized[field] = 'ANONYMIZED';
    }
  });

  // Add anonymization metadata
  anonymized._anonymized = true;
  anonymized._anonymizedAt = new Date().toISOString();

  return anonymized;
}

// Data retention helper
export function shouldRetainData(createdAt: Date, retentionDays: number = 2555): boolean {
  // Default 7 years for GDPR compliance
  const retentionPeriod = retentionDays * 24 * 60 * 60 * 1000; // days to milliseconds
  const now = Date.now();
  const created = new Date(createdAt).getTime();

  return (now - created) < retentionPeriod;
}