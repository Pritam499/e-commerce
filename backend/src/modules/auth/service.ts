import bcrypt from "bcrypt";
import { eq, and } from "drizzle-orm";
import { db } from "../../lib/db";
import { users, refreshTokens } from "../../drizzle/schema";
import { createId } from "@paralleldrive/cuid2";
import jwt from "jsonwebtoken";
import { encrypt, decrypt, encryptObject, decryptObject } from "../../lib/encryption";
import { logger } from "../../lib/logger";

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-super-secret-refresh-key";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserPayload {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(payload: UserPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as any);
}

export function generateRefreshToken(): string {
  return jwt.sign({}, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN } as any);
}

export function verifyAccessToken(token: string): UserPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as UserPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): boolean {
  try {
    jwt.verify(token, JWT_REFRESH_SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function createUser(email: string, password: string, name: string, role = "customer") {
  const passwordHash = await hashPassword(password);
  const userId = createId();

  // Encrypt sensitive data before storing
  const encryptedData = encryptObject({
    email,
    name,
  });

  logger.database('INSERT', 'users', { userId, role });

  const [newUser] = await db
    .insert(users)
    .values({
      id: userId,
      email: encryptedData.email,
      passwordHash,
      name: encryptedData.name,
      role,
    })
    .returning();

  // Decrypt data before returning
  const decryptedUser = decryptObject(newUser);
  return decryptedUser;
}

export async function findUserByEmail(email: string) {
  // We need to search by encrypted email, so we have to get all users and decrypt
  // In a production system, you might want to use a hash of the email for searching
  const allUsers = await db.select().from(users);

  for (const user of allUsers) {
    try {
      const decryptedUser = decryptObject(user);
      if (decryptedUser.email === email) {
        return decryptedUser;
      }
    } catch (error) {
      // Skip users we can't decrypt
      logger.warn('Failed to decrypt user data', { userId: user.id });
    }
  }

  return undefined;
}

export async function findUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));

  if (!user) return undefined;

  // Decrypt sensitive data
  const decryptedUser = decryptObject(user);
  return decryptedUser;
}

export async function validateCredentials(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user || !user.isActive) {
    logger.security('Failed login attempt', undefined, undefined, { email });
    return null;
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    logger.security('Invalid password', user.id, undefined, { email });
    return null;
  }

  logger.auth('Successful login', user.id, { email });
  return user;
}

export async function createRefreshToken(userId: string): Promise<string> {
  // Clean up expired tokens for this user
  await db.delete(refreshTokens).where(
    and(
      eq(refreshTokens.userId, userId),
      eq(refreshTokens.expiresAt, new Date(Date.now() - 1000)) // expired
    )
  );

  const token = generateRefreshToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(refreshTokens).values({
    id: createId(),
    userId,
    token,
    expiresAt,
  });

  return token;
}

export async function validateRefreshToken(token: string) {
  if (!verifyRefreshToken(token)) return null;

  const [refreshTokenRecord] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.token, token));

  if (!refreshTokenRecord || refreshTokenRecord.expiresAt < new Date()) {
    return null;
  }

  return refreshTokenRecord;
}

export async function revokeRefreshToken(token: string) {
  await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
}

export async function revokeAllUserTokens(userId: string) {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
}

export async function generateTokens(user: { id: string; email: string; name: string; role: string }): Promise<AuthTokens> {
  const payload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = await createRefreshToken(user.id);

  // Calculate expires in seconds (15 minutes)
  const expiresIn = 15 * 60;

  logger.auth('Tokens generated', user.id, {
    accessTokenExpiry: JWT_EXPIRES_IN,
    refreshTokenExpiry: JWT_REFRESH_EXPIRES_IN,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens | null> {
  const tokenRecord = await validateRefreshToken(refreshToken);
  if (!tokenRecord) return null;

  const user = await findUserById(tokenRecord.userId);
  if (!user || !user.isActive) return null;

  // Revoke the used refresh token and create a new one (token rotation)
  await revokeRefreshToken(refreshToken);

  return generateTokens(user);
}

export async function changeUserPassword(userId: string, oldPassword: string, newPassword: string) {
  const user = await findUserById(userId);
  if (!user) throw new Error("User not found");

  const isValidOldPassword = await verifyPassword(oldPassword, user.passwordHash);
  if (!isValidOldPassword) throw new Error("Invalid old password");

  const newPasswordHash = await hashPassword(newPassword);

  await db
    .update(users)
    .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Revoke all refresh tokens when password changes
  await revokeAllUserTokens(userId);
}