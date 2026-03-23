import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      sessionId?: string;
      deviceId?: string;
      roles?: string[];
      isGuest?: boolean;
    };
    requestId?: string;
  }
}
