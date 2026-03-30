import { onRequest as onLocalRequest } from "../../../cloudflare/pages-api/backend.js";
import {
  proxyToAliyun,
  shouldProxyToAliyun,
} from "../../../functions/_aliyunProxy.js";

export function onRequest(context) {
  if (shouldProxyToAliyun(context.env)) {
    return proxyToAliyun(context);
  }

  return onLocalRequest(context);
}
