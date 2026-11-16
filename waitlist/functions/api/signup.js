// POST /api/signup (spec 0017). One `onRequest` that switches on the method: a file with only
// `onRequestPost` would hand every other method to the static assets.
import { handleSignup, methodNotAllowed } from '../../lib/signup.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return methodNotAllowed('POST');
  return handleSignup(context.request, context.env);
}
