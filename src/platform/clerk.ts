import { Clerk } from "@clerk/clerk-js";
import { clientPlatformConfig } from "./config";

type SessionTokenHandler = (token: string) => Promise<void>;
type SignedOutHandler = () => Promise<void> | void;

class ClerkBridge {
  private clerk: Clerk | null = null;
  private initPromise: Promise<void> | null = null;
  private onSessionToken: SessionTokenHandler | null = null;
  private onSignedOut: SignedOutHandler | null = null;
  private lastSyncedSessionId: string | null = null;
  private suppressNextSignedOut = false;

  isEnabled(): boolean {
    return (
      clientPlatformConfig.clerk.enabled &&
      clientPlatformConfig.clerk.publishableKey.length > 0
    );
  }

  async initialize(options: {
    onSessionToken: SessionTokenHandler;
    onSignedOut?: SignedOutHandler;
  }): Promise<void> {
    this.onSessionToken = options.onSessionToken;
    this.onSignedOut = options.onSignedOut ?? null;

    if (!this.isEnabled()) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.initializeInternal();
    }

    await this.initPromise;
  }

  async resumeExistingSession(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    await this.ensureReady();
    if (!this.clerk?.session) {
      return false;
    }

    await this.syncSessionToken(this.clerk.session as any);
    return true;
  }

  async openSignIn(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    await this.ensureReady();
    this.clerk?.openSignIn({
      signUpUrl: clientPlatformConfig.clerk.signUpUrl || undefined,
      forceRedirectUrl:
        clientPlatformConfig.clerk.afterSignInUrl || window.location.href,
      fallbackRedirectUrl:
        clientPlatformConfig.clerk.afterSignInUrl || window.location.href,
      signUpForceRedirectUrl:
        clientPlatformConfig.clerk.afterSignUpUrl || window.location.href,
      signUpFallbackRedirectUrl:
        clientPlatformConfig.clerk.afterSignUpUrl || window.location.href,
    });
  }

  async signOut(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    await this.ensureReady();
    if (!this.clerk?.session) {
      return;
    }

    this.suppressNextSignedOut = true;
    this.lastSyncedSessionId = null;
    await this.clerk.signOut();
  }

  private async initializeInternal(): Promise<void> {
    this.clerk = new Clerk(clientPlatformConfig.clerk.publishableKey);
    await this.clerk.load({
      signInUrl: clientPlatformConfig.clerk.signInUrl || undefined,
      signUpUrl: clientPlatformConfig.clerk.signUpUrl || undefined,
      signInForceRedirectUrl:
        clientPlatformConfig.clerk.afterSignInUrl || window.location.href,
      signInFallbackRedirectUrl:
        clientPlatformConfig.clerk.afterSignInUrl || window.location.href,
      signUpForceRedirectUrl:
        clientPlatformConfig.clerk.afterSignUpUrl || window.location.href,
      signUpFallbackRedirectUrl:
        clientPlatformConfig.clerk.afterSignUpUrl || window.location.href,
    });

    this.clerk.addListener(({ session }: { session?: unknown }) => {
      const typedSession = session as
        | {
            id?: string;
            getToken?: () => Promise<string | null>;
          }
        | undefined;

      if (typedSession?.id) {
        void this.syncSessionToken(typedSession);
        return;
      }

      this.lastSyncedSessionId = null;
      if (this.suppressNextSignedOut) {
        this.suppressNextSignedOut = false;
        return;
      }
      void this.onSignedOut?.();
    });
  }

  private async ensureReady(): Promise<void> {
    if (!this.initPromise) {
      throw new Error("Clerk bridge is not initialized.");
    }
    await this.initPromise;
  }

  private async syncSessionToken(session: {
    id?: string;
    getToken?: () => Promise<string | null>;
  }): Promise<void> {
    const sessionId = typeof session.id === "string" ? session.id : null;
    if (!sessionId || sessionId === this.lastSyncedSessionId) {
      return;
    }

    const token = await session.getToken?.();
    if (!token || !this.onSessionToken) {
      return;
    }

    await this.onSessionToken(token);
    this.lastSyncedSessionId = sessionId;
  }
}

export const clerkBridge = new ClerkBridge();
