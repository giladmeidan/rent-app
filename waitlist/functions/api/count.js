// GET /api/count (spec 0017): the signup counter, edge-cached for 60 s in `caches.default`.
import { handleCount, methodNotAllowed } from '../../lib/signup.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const cache = globalThis.caches?.default;
  const waitUntil = context.waitUntil ? (promise) => context.waitUntil(promise) : undefined;
  return handleCount(context.request, context.env, cache, waitUntil);
}
