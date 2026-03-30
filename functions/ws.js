import { proxyToAliyun } from "./_aliyunProxy.js";

export function onRequest(context) {
  return proxyToAliyun(context);
}
