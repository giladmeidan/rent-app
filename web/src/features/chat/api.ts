import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

/** One of the caller's chats on `GET /me/conversations`; its `id` is the application's id for an
 * application chat, its own for a direct chat (spec 0010g: `listing` null, `my_role` `person`). */
export type ConversationOut = components['schemas']['ConversationOut'];
/** One chat with its newest messages, oldest first (`truncated`: older ones exist). */
export type ThreadOut = components['schemas']['ThreadOut'];
export type MessageOut = components['schemas']['MessageOut'];

/** The caller's chats, in the API's order. */
export async function fetchConversations(): Promise<ConversationOut[]> {
  const { data, error, response } = await api.GET('/me/conversations');
  if (data === undefined) throw new ApiError('GET', '/me/conversations', response.status, error);
  return data;
}

/** One chat (the GET marks it read for the caller). 404 `not_found` throws. */
export async function fetchThread(id: string): Promise<ThreadOut> {
  const { data, error, response } = await api.GET('/conversations/{conversation_id}', {
    params: { path: { conversation_id: id } },
  });
  if (data === undefined) {
    throw new ApiError('GET', '/conversations/{id}', response.status, error);
  }
  return data;
}

/** Sends a plain-text message. 409 `chat_closed`, 404, 422, 429 `rate_limited`, … throw. */
export async function sendMessage(id: string, body: string): Promise<MessageOut> {
  const { data, error, response } = await api.POST('/conversations/{conversation_id}/messages', {
    params: { path: { conversation_id: id } },
    body: { body },
  });
  if (data === undefined) {
    throw new ApiError('POST', '/conversations/{id}/messages', response.status, error);
  }
  return data;
}
