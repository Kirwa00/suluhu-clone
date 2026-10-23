import { Hono } from 'hono';
import { sendMessageSchema, startConversationSchema, uuidSchema } from '@suluhu/shared';
import { must } from '../lib/must';
import { requestContext } from '../lib/request-context';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's MessagingController (`conversations`).
export const conversations = new Hono<AppEnv>();

conversations.get(
  '/',
  rateLimit('RATE_LIMITER_CONVERSATIONS_LIST'),
  requireAuth(),
  async (c) => {
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).messaging.listConversations(user);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

conversations.post(
  '/',
  rateLimit('RATE_LIMITER_CONVERSATIONS_OPEN'),
  requireAuth(),
  async (c) => {
    const dto = startConversationSchema.parse(await c.req.json().catch(() => ({})));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).messaging.getOrCreate(
      user,
      dto.counterpartId,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

conversations.get(
  '/:id/messages',
  rateLimit('RATE_LIMITER_CONVERSATIONS_MESSAGES_GET'),
  requireAuth(),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).messaging.getMessages(user, id);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

conversations.post(
  '/:id/messages',
  rateLimit('RATE_LIMITER_CONVERSATIONS_MESSAGES_SEND'),
  requireAuth(),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const dto = sendMessageSchema.parse(await c.req.json().catch(() => ({})));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).messaging.send(
      user,
      id,
      dto.body,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')), 201);
  },
);
