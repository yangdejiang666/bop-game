import { handleReadyzRequest } from "../cloudflare/pages-api/backend.js";

export function onRequest(context) {
  return handleReadyzRequest(context);
}
