import { FastifyPluginAsync } from "fastify";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  type RegisterInput,
  type LoginInput,
  type RefreshTokenInput,
  type ChangePasswordInput,
} from "../modules/auth/schema";
import {
  createUser,
  validateCredentials,
  generateTokens,
  refreshAccessToken,
  changeUserPassword,
  findUserByEmail,
  revokeRefreshToken,
  revokeAllUserTokens,
} from "../modules/auth/service";

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Register
  fastify.post<{ Body: RegisterInput }>("/register", {
    schema: {
      body: registerSchema,
    },
  }, async (request, reply) => {
    const { email, password, name } = request.body;

    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return reply.code(409).send({ error: "User already exists" });
    }

    // Create user
    const user = await createUser(email, password, name);

    // Generate tokens
    const tokens = await generateTokens(user);

    // Set refresh token as httpOnly cookie
    reply.setCookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    return reply.code(201).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });
  });

  // Login
  fastify.post<{ Body: LoginInput }>("/login", {
    schema: {
      body: loginSchema,
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    const user = await validateCredentials(email, password);
    if (!user) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    // Generate tokens
    const tokens = await generateTokens(user);

    // Set refresh token as httpOnly cookie
    reply.setCookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });
  });

  // Refresh token
  fastify.post<{ Body: RefreshTokenInput }>("/refresh", {
    schema: {
      body: refreshTokenSchema,
    },
  }, async (request, reply) => {
    const { refreshToken } = request.body;

    if (!refreshToken) {
      return reply.code(401).send({ error: "Refresh token required" });
    }

    const tokens = await refreshAccessToken(refreshToken);
    if (!tokens) {
      return reply.code(401).send({ error: "Invalid refresh token" });
    }

    // Set new refresh token as httpOnly cookie
    reply.setCookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    return reply.send({
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });
  });

  // Logout
  fastify.post("/logout", async (request, reply) => {
    const refreshToken = request.cookies.refreshToken;

    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }

    reply.clearCookie("refreshToken", { path: "/" });
    return reply.send({ message: "Logged out successfully" });
  });

  // Change password (requires auth)
  fastify.post<{ Body: ChangePasswordInput }>("/change-password", {
    schema: {
      body: changePasswordSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { oldPassword, newPassword } = request.body;
    const userId = request.user!.id; // From JWT middleware

    try {
      await changeUserPassword(userId, oldPassword, newPassword);

      // Clear refresh token cookie since all tokens are revoked
      reply.clearCookie("refreshToken", { path: "/" });

      return reply.send({ message: "Password changed successfully" });
    } catch (error: any) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  // Get current user (requires auth)
  fastify.get("/me", {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    return reply.send({
      user: request.user,
    });
  });
};