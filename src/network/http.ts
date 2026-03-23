import type { ProtocolResponse, ProtocolFailurePayload } from '../../shared-protocol/src/errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined;
  prepareAuth?: () => Promise<unknown> | unknown;
  getRequestId?: () => string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpRequestOptions<TBody = unknown> {
  method?: HttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: TBody;
  signal?: AbortSignal;
  timeoutMs?: number;
  withAuth?: boolean;
}

export class HttpProtocolError extends Error {
  public readonly status: number;
  public readonly payload: ProtocolFailurePayload | null;
  public readonly raw: unknown;

  constructor(message: string, status: number, payload: ProtocolFailurePayload | null, raw: unknown) {
    super(message);
    this.name = 'HttpProtocolError';
    this.status = status;
    this.payload = payload;
    this.raw = raw;
  }
}

function buildQueryString(query?: HttpRequestOptions['query']): string {
  if (!query) return '';
  const sp = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    sp.append(key, String(value));
  }

  const str = sp.toString();
  return str ? `?${str}` : '';
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const next = path.replace(/^\/+/, '');
  return `${base}/${next}`;
}

function isProtocolFailurePayload(value: unknown): value is ProtocolFailurePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.ok === false && typeof v.error === 'object' && v.error !== null;
}

function createAbortController(timeoutMs?: number) {
  if (!timeoutMs || timeoutMs <= 0) return { controller: undefined as AbortController | undefined, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
  return {
    controller,
    cleanup: () => clearTimeout(timer)
  };
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => string | null | undefined;
  private readonly prepareAuth?: () => Promise<unknown> | unknown;
  private readonly getRequestId?: () => string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs?: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.getAccessToken = options.getAccessToken;
    this.prepareAuth = options.prepareAuth;
    this.getRequestId = options.getRequestId;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs;
  }

  async request<TData, TBody = unknown>(
    path: string,
    options: HttpRequestOptions<TBody> = {}
  ): Promise<ProtocolResponse<TData>> {
    const method = options.method ?? 'GET';
    const url = `${joinUrl(this.baseUrl, path)}${buildQueryString(options.query)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...(options.headers ?? {})
    };

    const withAuth = options.withAuth ?? true;
    if (withAuth && this.getAccessToken) {
      await this.prepareAuth?.();
      const token = this.getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    if (this.getRequestId && !headers['x-request-id']) {
      headers['x-request-id'] = this.getRequestId();
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined && method !== 'GET') {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      body = headers['Content-Type'].includes('application/json')
        ? JSON.stringify(options.body)
        : (options.body as unknown as BodyInit);
    }

    const timeout = options.timeoutMs ?? this.timeoutMs;
    const { controller, cleanup } = createAbortController(timeout);

    const signal = options.signal ?? controller?.signal;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal
      });

      const text = await response.text();
      const raw = text ? safeJsonParse(text) : null;

      if (!raw || typeof raw !== 'object') {
        throw new HttpProtocolError('Invalid JSON response payload.', response.status, null, raw);
      }

      if (!response.ok) {
        const failure = isProtocolFailurePayload(raw) ? raw : null;
        throw new HttpProtocolError(
          failure?.error?.message ?? `HTTP ${response.status}`,
          response.status,
          failure,
          raw
        );
      }

      return raw as ProtocolResponse<TData>;
    } catch (error) {
      if (error instanceof HttpProtocolError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown request error';
      throw new HttpProtocolError(message, 0, null, error);
    } finally {
      cleanup();
    }
  }

  get<TData>(path: string, options: Omit<HttpRequestOptions<never>, 'method' | 'body'> = {}) {
    return this.request<TData, never>(path, { ...options, method: 'GET' });
  }

  post<TData, TBody = unknown>(path: string, body?: TBody, options: Omit<HttpRequestOptions<TBody>, 'method' | 'body'> = {}) {
    return this.request<TData, TBody>(path, { ...options, method: 'POST', body });
  }

  put<TData, TBody = unknown>(path: string, body?: TBody, options: Omit<HttpRequestOptions<TBody>, 'method' | 'body'> = {}) {
    return this.request<TData, TBody>(path, { ...options, method: 'PUT', body });
  }

  patch<TData, TBody = unknown>(path: string, body?: TBody, options: Omit<HttpRequestOptions<TBody>, 'method' | 'body'> = {}) {
    return this.request<TData, TBody>(path, { ...options, method: 'PATCH', body });
  }

  delete<TData>(path: string, options: Omit<HttpRequestOptions<never>, 'method' | 'body'> = {}) {
    return this.request<TData, never>(path, { ...options, method: 'DELETE' });
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
