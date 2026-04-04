const DEFAULT_UPSTREAM_ORIGIN = "http://8.163.55.135";

function isTruthy(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function isProxyEnabled(env) {
  const raw = String(env?.ALIYUN_PROXY_ENABLED ?? "").trim();
  if (!raw) {
    // Default to the ECS IP proxy in production Pages/Workers deployments.
    // An explicit false-ish value can still disable the bridge if needed.
    return true;
  }

  return isTruthy(raw);
}

function getUpstreamOrigin(env) {
  const configured = String(env?.ALIYUN_UPSTREAM_ORIGIN ?? "").trim();
  return configured || DEFAULT_UPSTREAM_ORIGIN;
}

export function buildUpstreamRequest(request, env) {
  const upstreamOrigin = getUpstreamOrigin(env);
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, upstreamOrigin);

  const headers = new Headers(request.headers);
  headers.set("host", upstreamUrl.host);
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") || "");

  return new Request(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });
}

export async function proxyToAliyun(context) {
  return fetch(buildUpstreamRequest(context.request, context.env));
}

export function shouldProxyToAliyun(env) {
  return isProxyEnabled(env);
}
