import { handleApiRequest } from '../../src/server/api.js';

export async function onRequest(context) {
  return handleApiRequest(context.request, context.env, context);
}
