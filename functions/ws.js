import { proxyToAliyun, shouldProxyToAliyun } from "./_aliyunProxy.js";

export function onRequest(context) {
  if (!shouldProxyToAliyun(context.env)) {
    return new Response("Same-origin websocket proxy is disabled.", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return proxyToAliyun(context);
}
