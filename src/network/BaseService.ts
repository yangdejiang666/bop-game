import { HttpClient } from "./http";
import type { ProtocolResponse } from "../../shared-protocol/src/errors";
import { networkConfig } from "./config";
import { authService } from "./authService";

/**
 * 依赖注入容器，用于 BaseService 构造。
 *
 * - `httpClient`: 外部注入的 HttpClient 实例（测试/Mock 场景）
 *
 * 不传时自动创建默认实例（连接 authService 单例）。
 */
export interface BaseServiceDeps {
  httpClient?: HttpClient;
}

/**
 * 所有网络 Service 的统一基类。
 *
 * 职责：
 * 1. 封装共享的 HttpClient 实例（避免每个 Service 重复创建）
 * 2. 提供 authGet/authPost 等快捷方法（自动带 Bearer Token + 自动解包为裸 data）
 * 3. 提供 publicGet/publicPost 等快捷方法（无需认证）
 * 4. 提供 rawGet/rawPost 返回完整 ProtocolResponse（不解包）
 * 5. 提供 unwrap() 助手：将 ProtocolResponse<T> 解包或抛 Error
 *
 * 使用示例：
 * ```ts
 * class FooService extends BaseService {
 *   async getFoo(id: string): Promise<FooResponse> {
 *     return this.authGet<FooResponse>(`/foo/${id}`);
 *   }
 *   async createFoo(body: CreateFooRequest): Promise<FooResponse> {
 *     return this.publicPost<FooResponse, CreateFooRequest>("/foo", body);
 *   }
 * }
 * ```
 */
export abstract class BaseService {
  protected readonly http: HttpClient;

  constructor(deps: BaseServiceDeps = {}) {
    this.http =
      deps.httpClient ??
      new HttpClient({
        baseUrl: networkConfig.apiBaseUrl,
        prepareAuth: () => authService.refreshToken(),
        getAccessToken: () => authService.getSession()?.accessToken ?? null,
        getRequestId: () => `req_${Math.random().toString(36).slice(2, 10)}`,
        timeoutMs: networkConfig.requestTimeoutMs,
      });
  }

  // ─── 认证请求快捷方法（自动带 Token，返回裸 data）───

  protected async authGet<T>(path: string, options?: Parameters<HttpClient["get"]>[1]): Promise<T> {
    return this.unwrap(await this.http.get<T>(path, { ...options, withAuth: true }));
  }

  protected async authPost<T, B = unknown>(
    path: string,
    body?: B,
    options?: Parameters<HttpClient["post"]>[2],
  ): Promise<T> {
    return this.unwrap(
      await this.http.post<T, B>(path, body, { ...options, withAuth: true }),
    );
  }

  protected async authPut<T, B = unknown>(
    path: string,
    body?: B,
    options?: Parameters<HttpClient["put"]>[2],
  ): Promise<T> {
    return this.unwrap(await this.http.put<T, B>(path, body, { ...options, withAuth: true }));
  }

  protected async authPatch<T, B = unknown>(
    path: string,
    body?: B,
    options?: Parameters<HttpClient["patch"]>[2],
  ): Promise<T> {
    return this.unwrap(
      await this.http.patch<T, B>(path, body, { ...options, withAuth: true }),
    );
  }

  protected async authDelete<T>(path: string, options?: Parameters<HttpClient["delete"]>[1]): Promise<T> {
    return this.unwrap(await this.http.delete<T>(path, { ...options, withAuth: true }));
  }

  // ─── 公开请求快捷方法（无需认证头）───

  protected async publicGet<T>(path: string, options?: Parameters<HttpClient["get"]>[1]): Promise<T> {
    return this.unwrap(await this.http.get<T>(path, { ...options, withAuth: false }));
  }

  protected async publicPost<T, B = unknown>(
    path: string,
    body?: B,
    options?: Parameters<HttpClient["post"]>[2],
  ): Promise<T> {
    return this.unwrap(
      await this.http.post<T, B>(path, body, { ...options, withAuth: false }),
    );
  }

  // ─── 原始请求（返回完整 ProtocolResponse，不解包）───

  /**
   * 发送 GET 请求，返回完整的 ProtocolResponse（含 ok/error/data）。
   * 用于需要自行判断 ok/false 的场景（如 AuthService 的 register/login）。
   */
  protected async rawGet<T>(
    path: string,
    options?: Parameters<HttpClient["get"]>[1],
  ): Promise<ProtocolResponse<T>> {
    return this.http.get<T>(path, options);
  }

  /**
   * 发送 POST 请求，返回完整的 ProtocolResponse。
   */
  protected async rawPost<T, B = unknown>(
    path: string,
    body?: B,
    options?: Parameters<HttpClient["post"]>[2],
  ): Promise<ProtocolResponse<T>> {
    return this.http.post<T, B>(path, body, options);
  }

  // ─── 响应解包 ───

  /**
   * 将 ProtocolResponse 解包为裸 data。
   * 当 ok=false 时抛出 Error（携带 code/details 元信息）。
   */
  protected unwrap<T>(response: ProtocolResponse<T>): T {
    if (!response.ok) {
      const error = response.error!;
      const err = new Error(error.message) as Error & {
        code: string;
        details?: unknown;
        status?: number;
      };
      err.code = error.code;
      err.details = error.details;
      throw err;
    }
    return response.data!;
  }
}
