import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { ZodSchema, ZodError } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    try {
      request.body = schema.parse(request.body);
      done();
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Validation failed",
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        });
      }
      done(error as Error);
    }
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    try {
      request.params = schema.parse(request.params);
      done();
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Parameter validation failed",
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        });
      }
      done(error as Error);
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    try {
      request.query = schema.parse(request.query);
      done();
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Query validation failed",
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        });
      }
      done(error as Error);
    }
  };
}