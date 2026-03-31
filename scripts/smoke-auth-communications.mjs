import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "../api-server/node_modules/pg/lib/index.js";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const apiBaseUrl = process.env.SMOKE_API_BASE_URL || "http://127.0.0.1:8788/api/v1";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        return acc;
      }
      const index = line.indexOf("=");
      if (index <= 0) {
        return acc;
      }
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function assertOk(response, step) {
  if (!response.ok) {
    const error = describeError(response);
    throw new Error(`${step} failed: ${error}`);
  }
  return response.data;
}

function describeError(response) {
  return response?.error
    ? `${response.error.code}: ${response.error.message}`
    : JSON.stringify(response);
}

async function apiRequest(pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return response.json();
}

async function queryOne(client, text, params = []) {
  const result = await client.query(text, params);
  return result.rows[0] ?? null;
}

async function getLatestChallengeCode(client, whereSql, params) {
  const row = await queryOne(
    client,
    `
      SELECT debug_payload
      FROM auth_verification_challenges
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    params,
  );

  const code = row?.debug_payload?.code;
  if (typeof code !== "string" || !code.trim()) {
    throw new Error(`No debug verification code found for ${whereSql}`);
  }
  return code.trim();
}

async function main() {
  const env = {
    ...loadEnvFile(path.join(rootDir, "api-server", ".env")),
    ...loadEnvFile(path.join(rootDir, "api-server", ".env.local")),
    ...process.env,
  };
  const connectionString =
    env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bop";
  const db = new Client({ connectionString });

  const now = Date.now();
  const account = `smoke_${now}`;
  const smokeEmailOverride = (process.env.SMOKE_EMAIL || "").trim();
  const email = smokeEmailOverride || `smoke+${now}@example.com`;
  const mobile = `139${String(now).slice(-8)}`;
  const password = "demo123456";
  const resetPassword1 = "reset123456";
  const resetPassword2 = "reset654321";

  console.log(`API base: ${apiBaseUrl}`);
  console.log(`Smoke account: ${account}`);
  console.log(`Smoke email: ${email}`);
  console.log(`Smoke mobile: +86 ${mobile}`);

  await db.connect();

  try {
    const platformConfig = assertOk(
      await apiRequest("/platform/config"),
      "load platform config",
    );

    const register = assertOk(
      await apiRequest("/auth/register", {
        method: "POST",
        body: {
          account,
          password,
          nickname: "SmokeAuth",
        },
      }),
      "register",
    );
    const accessToken = register.tokens.accessToken;

    let emailSend = null;
    let bindEmail = null;
    let emailReset = null;
    let emailSandboxRestricted = false;
    const shouldAttemptEmailSmoke =
      platformConfig.auth.emailVerificationEnabled &&
      (platformConfig.auth.emailProvider !== "resend" ||
        smokeEmailOverride.length > 0);

    if (!platformConfig.auth.emailVerificationEnabled) {
      console.log("Email smoke note: email verification is disabled in platform config.");
    } else if (!shouldAttemptEmailSmoke) {
      emailSandboxRestricted = true;
      console.log(
        "Email smoke note: Resend is active but no real SMOKE_EMAIL was provided, so outbound email verification was skipped.",
      );
    } else {
      const emailSendResponse = await apiRequest("/auth/email/send", {
        method: "POST",
        body: {
          email,
          purpose: "bindEmail",
        },
      });
      if (emailSendResponse.ok) {
        emailSend = emailSendResponse.data;
        const emailCode = await getLatestChallengeCode(
          db,
          "channel = 'email' AND purpose = 'bindEmail' AND email = $1",
          [email],
        );
        bindEmail = assertOk(
          await apiRequest("/auth/bind/email", {
            method: "POST",
            token: accessToken,
            body: {
              email,
              code: emailCode,
            },
          }),
          "bind email",
        );
      } else {
        const emailError = describeError(emailSendResponse);
        if (
          !smokeEmailOverride &&
          (
            emailError.includes("You can only send testing emails to your own email address")
            || emailError.includes("Unable to fetch data. The request could not be resolved")
          )
        ) {
          emailSandboxRestricted = true;
          console.log(
            "Email smoke note: provider rejected the synthetic mailbox, so outbound email verification was skipped.",
          );
        } else {
          throw new Error(`send email bind code failed: ${emailError}`);
        }
      }
    }

    let smsSend = null;
    let bindMobile = null;
    let smsLogin = null;
    let smsReset = null;

    if (platformConfig.auth.smsVerificationEnabled) {
      smsSend = assertOk(
        await apiRequest("/auth/sms/send", {
          method: "POST",
          body: {
            countryCode: "+86",
            mobile,
            purpose: "bindMobile",
          },
        }),
        "send sms bind code",
      );
      const bindSmsCode = await getLatestChallengeCode(
        db,
        "channel = 'sms' AND purpose = 'bindMobile' AND phone_e164 = $1",
        [`+86${mobile}`],
      );
      bindMobile = assertOk(
        await apiRequest("/auth/bind/mobile", {
          method: "POST",
          token: accessToken,
          body: {
            countryCode: "+86",
            mobile,
            code: bindSmsCode,
          },
        }),
        "bind mobile",
      );

      assertOk(
        await apiRequest("/auth/sms/send", {
          method: "POST",
          body: {
            countryCode: "+86",
            mobile,
            purpose: "login",
          },
        }),
        "send sms login code",
      );
      const loginSmsCode = await getLatestChallengeCode(
        db,
        "channel = 'sms' AND purpose = 'login' AND phone_e164 = $1",
        [`+86${mobile}`],
      );
      smsLogin = assertOk(
        await apiRequest("/auth/login", {
          method: "POST",
          body: {
            method: "sms",
            payload: {
              countryCode: "+86",
              mobile,
              code: loginSmsCode,
            },
          },
        }),
        "login by sms",
      );
    } else {
      console.log("SMS smoke note: SMS verification is disabled in platform config.");
    }

    if (bindEmail) {
      emailReset = assertOk(
        await apiRequest("/auth/password/request-reset", {
          method: "POST",
          body: {
            account,
            verifyBy: "email",
          },
        }),
        "request email reset",
      );
      const emailResetCode = await getLatestChallengeCode(
        db,
        "challenge_id = $1",
        [emailReset.challengeId],
      );
      assertOk(
        await apiRequest("/auth/password/confirm-reset", {
          method: "POST",
          body: {
            challengeId: emailReset.challengeId,
            verificationCode: emailResetCode,
            newPassword: resetPassword1,
          },
        }),
        "confirm email reset",
      );

      assertOk(
        await apiRequest("/auth/login", {
          method: "POST",
          body: {
            method: "password",
            payload: {
              account,
              password: resetPassword1,
            },
          },
        }),
        "login with email-reset password",
      );
    }

    if (platformConfig.auth.smsVerificationEnabled) {
      smsReset = assertOk(
        await apiRequest("/auth/password/request-reset", {
          method: "POST",
          body: {
            account,
            verifyBy: "sms",
          },
        }),
        "request sms reset",
      );
      const smsResetCode = await getLatestChallengeCode(
        db,
        "challenge_id = $1",
        [smsReset.challengeId],
      );
      assertOk(
        await apiRequest("/auth/password/confirm-reset", {
          method: "POST",
          body: {
            challengeId: smsReset.challengeId,
            verificationCode: smsResetCode,
            newPassword: resetPassword2,
          },
        }),
        "confirm sms reset",
      );
    }

    const passwordLogin = assertOk(
      await apiRequest("/auth/login", {
        method: "POST",
        body: {
          method: "password",
          payload: {
            account,
            password:
              platformConfig.auth.smsVerificationEnabled
                ? resetPassword2
                : bindEmail
                  ? resetPassword1
                  : password,
          },
        },
      }),
      platformConfig.auth.smsVerificationEnabled
        ? "login with sms-reset password"
        : bindEmail
          ? "login with email-reset password"
          : "login with initial password",
    );

    const identityRow = await queryOne(
      db,
      `
        SELECT
          COUNT(*) FILTER (WHERE email = $2 AND email_verified = TRUE) AS email_bound,
          COUNT(*) FILTER (WHERE phone = $3 AND phone_verified = TRUE) AS phone_bound
        FROM user_identities
        WHERE user_id = $1
      `,
      [register.user.userId, email, `+86${mobile}`],
    );

    console.log("");
    console.log("Smoke summary");
    console.log(
      JSON.stringify(
        {
          emailProvider: platformConfig.auth.emailProvider,
          smsProvider: platformConfig.auth.smsProvider,
          emailSandboxRestricted,
          emailSend,
          bindEmail,
          emailResetChallengeId: emailReset?.challengeId ?? null,
          smsSend,
          smsResetChallengeId: smsReset?.challengeId ?? null,
          bindMobile,
          smsLoginUserId: smsLogin?.user?.userId ?? null,
          passwordLoginUserId: passwordLogin.user.userId,
          emailBound: Number(identityRow?.email_bound ?? 0) > 0,
          phoneBound: Number(identityRow?.phone_bound ?? 0) > 0,
        },
        null,
        2,
      ),
    );
    console.log("");
    console.log("Smoke auth communications: PASS");
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
