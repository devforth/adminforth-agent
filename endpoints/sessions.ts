import type { IHttpServer } from "adminforth";
import { Filters, Sorts } from "adminforth";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { SessionEndpointsContext } from "./context.js";

const addSystemMessageBodySchema = z.object({
  sessionId: z.string(),
  systemMessage: z.string(),
}).strict();

const getSessionsBodySchema = z.object({
  limit: z.number().optional(),
}).strict();

const sessionIdBodySchema = z.object({
  sessionId: z.string(),
}).strict();

const createSessionBodySchema = z.object({
  triggerMessage: z.string().optional(),
}).strict();

export function setupSessionEndpoints(ctx: SessionEndpointsContext, server: IHttpServer) {
  server.endpoint({
    method: 'POST',
    path: `/agent/get-sessions`,
    handler: async ({body, adminUser, response }) => {
      const data = ctx.parseBody(getSessionsBodySchema, body, response);
      if (!data) return;
      const userId = adminUser!.pk;
      const limit = data.limit ?? 20;
      const sessions = await ctx.adminforth.resource(ctx.options.sessionResource.resourceId).list(
        [Filters.EQ(ctx.options.sessionResource.askerIdField, userId)], limit, undefined, [Sorts.DESC(ctx.options.sessionResource.createdAtField)]
      );
      return {
        sessions: sessions.map((session) => ({
          sessionId: session[ctx.options.sessionResource.idField],
          title: session[ctx.options.sessionResource.titleField],
          timestamp: session[ctx.options.sessionResource.createdAtField],
        })),
      };
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/get-session-info`,
    handler: async ({body, adminUser, response }) => {
      const data = ctx.parseBody(sessionIdBodySchema, body, response);
      if (!data) return;
      const userId = adminUser!.pk;
      const sessionId = data.sessionId;
      const session = await ctx.adminforth.resource(ctx.options.sessionResource.resourceId).get(
        [Filters.EQ(ctx.options.sessionResource.idField, sessionId)]
      );
      if (!session) {
        return {
          error: 'Session not found'
        };
      }
      if (session[ctx.options.sessionResource.askerIdField] !== userId) {
        return {
          error: 'Unauthorized'
        };
      }
      const turns = await ctx.getSessionTurns(sessionId);
      return {
        session: {
          sessionId,
          title: session[ctx.options.sessionResource.titleField],
          timestamp: session[ctx.options.sessionResource.createdAtField],
          messages: turns.flatMap(turn => {
            const messages: Array<{ text: string; role: 'user' | 'assistant' }> = [];
            if (turn.prompt) {
              messages.push({
                text: turn.prompt,
                role: 'user',
              });
            }
            if (turn.response && turn.response !== "not_finished") {
              messages.push({
                text: turn.response,
                role: 'assistant',
              });
            }
            return messages;
          }),
        },
      };
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/create-session`,
    handler: async ({body, adminUser, response }) => {
      const data = ctx.parseBody(createSessionBodySchema, body, response);
      if (!data) return;
      const triggerMessage = data.triggerMessage;
      const userId = adminUser!.pk;
      const title = triggerMessage?.slice(0, 40) || "New Session";
      const newSession = {
        [ctx.options.sessionResource.idField]: randomUUID(),
        [ctx.options.sessionResource.titleField]: title,
        [ctx.options.sessionResource.askerIdField]: userId,
      };
      const { createdRecord } = await ctx.adminforth.resource(ctx.options.sessionResource.resourceId).create(newSession);
      return {
        sessionId: createdRecord[ctx.options.sessionResource.idField],
        title: createdRecord[ctx.options.sessionResource.titleField],
        timestamp: createdRecord[ctx.options.sessionResource.createdAtField],
        messages: []
      };
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/delete-session`,
    handler: async ({body, adminUser, response }) => {
      const data = ctx.parseBody(sessionIdBodySchema, body, response);
      if (!data) return;
      const sessionId = data.sessionId;
      const userId = adminUser!.pk;
      const session = await ctx.adminforth.resource(ctx.options.sessionResource.resourceId).get(
        [Filters.EQ(ctx.options.sessionResource.idField, sessionId)]
      );
      if (!session) {
        return {
          error: 'Session not found'
        };
      }
      if (session[ctx.options.sessionResource.askerIdField] !== userId) {
        return {
          error: 'Unauthorized'
        };
      }
      await ctx.adminforth.resource(ctx.options.sessionResource.resourceId).delete(sessionId);
      const turns = await ctx.adminforth.resource(ctx.options.turnResource.resourceId).list(
        [Filters.EQ(ctx.options.turnResource.sessionIdField, sessionId)]
      );
      for (const turn of turns) {
        await ctx.adminforth.resource(ctx.options.turnResource.resourceId).delete(turn[ctx.options.turnResource.idField]);
      }
      return {
        ok: true
      };
    }
  });

  server.endpoint({
    method: 'POST',
    path: `/agent/add-system-message-to-turns`,
    handler: async ({body, adminUser, response }) => {
      const data = ctx.parseBody(addSystemMessageBodySchema, body, response);
      if (!data) return;
      const session = await ctx.adminforth.resource(ctx.options.sessionResource.resourceId).get(
        [Filters.EQ(ctx.options.sessionResource.idField, data.sessionId)]
      );
      if (!session) {
        return {
          error: 'Session not found'
        };
      }
      if (session[ctx.options.sessionResource.askerIdField] !== adminUser!.pk) {
        return {
          error: 'Unauthorized'
        };
      }
      await ctx.createNewTurn(data.sessionId, data.systemMessage);
      return {
        ok: true
      }
    }
  })
}
