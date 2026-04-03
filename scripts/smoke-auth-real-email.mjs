function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) {
    return fallback;
  }

  return next;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `${url} -> ${response.status} ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`,
    );
  }

  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickVerificationCode(messageText) {
  const matches = [
    ...messageText.matchAll(/验证码[^\d]*(\d{6})/g),
    ...messageText.matchAll(/\b(\d{6})\b/g),
  ]
    .map((match) => match[1])
    .filter((value) => typeof value === "string" && value.length === 6);

  return matches.length > 0 ? matches[matches.length - 1] : null;
}

async function createTempMailbox() {
  const domainPayload = await fetchJson("https://api.mail.tm/domains");
  const domain = domainPayload["hydra:member"]?.[0]?.domain;
  if (!domain) {
    throw new Error("mail.tm returned no available domain.");
  }

  const now = Date.now();
  const address = `bop${now}@${domain}`;
  const password = `Pwd!${now}`;

  await fetchJson("https://api.mail.tm/accounts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      address,
      password,
    }),
  });

  const tokenPayload = await fetchJson("https://api.mail.tm/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      address,
      password,
    }),
  });

  return {
    address,
    token: tokenPayload.token,
  };
}

async function waitForTempMessage(mailToken, timeoutMs = 75_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const inbox = await fetchJson("https://api.mail.tm/messages", {
      headers: {
        Authorization: `Bearer ${mailToken}`,
      },
    });
    const message = inbox["hydra:member"]?.[0] ?? null;
    if (message?.id) {
      const full = await fetchJson(`https://api.mail.tm/messages/${message.id}`, {
        headers: {
          Authorization: `Bearer ${mailToken}`,
        },
      });
      return full;
    }

    await sleep(3000);
  }

  throw new Error("Timed out waiting for a temp inbox message.");
}

async function main() {
  const apiBaseUrl =
    readArg("--api-base", process.env.SMOKE_API_BASE_URL || "").trim() ||
    "http://127.0.0.1:8790/api/v1";
  const password = "demo123456";
  const account = `realmail_${Date.now()}`;
  const mailbox = await createTempMailbox();

  const register = await fetchJson(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account,
      password,
      nickname: "RealMail",
    }),
  });

  const accessToken = register.data?.tokens?.accessToken;
  if (!accessToken) {
    throw new Error("Register response did not include an access token.");
  }

  const sendResult = await fetchJson(`${apiBaseUrl}/auth/email/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: mailbox.address,
      purpose: "bindEmail",
    }),
  });

  const fullMessage = await waitForTempMessage(mailbox.token);
  const messageText = [
    fullMessage.subject || "",
    fullMessage.text || "",
    Array.isArray(fullMessage.html)
      ? fullMessage.html.join("\n")
      : fullMessage.html || "",
  ].join("\n");
  const verificationCode = pickVerificationCode(messageText);
  if (!verificationCode) {
    throw new Error(
      `Could not extract a verification code from the inbox message: ${messageText.slice(0, 600)}`,
    );
  }

  const bindResult = await fetchJson(`${apiBaseUrl}/auth/bind/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      email: mailbox.address,
      code: verificationCode,
    }),
  });

  console.log(
    JSON.stringify(
      {
        apiBaseUrl,
        mailbox: mailbox.address,
        subject: fullMessage.subject || null,
        code: verificationCode,
        sendOk: sendResult.ok ?? true,
        bindOk: bindResult.ok ?? true,
        emailMasked: bindResult.data?.emailMasked || null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
