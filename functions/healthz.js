import { handleHealthzRequest } from "../cloudflare/pages-api/backend.js";

export function onRequest(context) {
  return handleHealthzRequest(context);
}
