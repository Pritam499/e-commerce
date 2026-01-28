import { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import { verifyAccessToken, UserPayload } from "../modules/auth/service";

declare module "fastify" {
  interface FastifyRequest {
    user?: UserPayload;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Authorization token required" });
  }

  const token = authHeader.substring(7); // Remove "Bearer "
  const user = verifyAccessToken(token);

  if (!user) {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }

  request.user = user;
}

export function authorize(roles: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }
  };
}