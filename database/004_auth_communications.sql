-- bop/database/004_auth_communications.sql
-- Auth communications foundation:
-- - email/sms verification challenges
-- - inbound email persistence for webhook-driven receive flows

BEGIN;

CREATE TABLE IF NOT EXISTS auth_verification_challenges (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id        VARCHAR(64) NOT NULL UNIQUE,
    channel             VARCHAR(16) NOT NULL
                            CHECK (channel IN ('email', 'sms')),
    purpose             VARCHAR(32) NOT NULL
                            CHECK (purpose IN ('login', 'register', 'resetPassword', 'bindMobile', 'bindEmail')),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    account             VARCHAR(64),
    email               VARCHAR(191),
    phone_country_code  VARCHAR(8),
    phone_number        VARCHAR(32),
    phone_e164          VARCHAR(32),
    code_hash           TEXT NOT NULL,
    attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts        INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    delivery_provider   VARCHAR(32) NOT NULL,
    provider_message_id VARCHAR(128),
    send_status         VARCHAR(16) NOT NULL DEFAULT 'pending'
                            CHECK (send_status IN ('pending', 'sent', 'failed', 'consumed', 'expired', 'cancelled')),
    send_error          TEXT,
    debug_payload       JSONB,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at          TIMESTAMPTZ NOT NULL,
    sent_at             TIMESTAMPTZ,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_auth_verification_target CHECK (
        (channel = 'email' AND email IS NOT NULL AND phone_e164 IS NULL)
        OR
        (channel = 'sms' AND phone_e164 IS NOT NULL AND email IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_auth_verification_email_target
ON auth_verification_challenges(channel, purpose, email, created_at DESC)
WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_verification_phone_target
ON auth_verification_challenges(channel, purpose, phone_e164, created_at DESC)
WHERE phone_e164 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_verification_user
ON auth_verification_challenges(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_verification_status
ON auth_verification_challenges(send_status, expires_at);

CREATE TABLE IF NOT EXISTS platform_inbound_emails (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider            VARCHAR(32) NOT NULL,
    email_id            VARCHAR(128) NOT NULL UNIQUE,
    received_at         TIMESTAMPTZ NOT NULL,
    from_email          VARCHAR(320) NOT NULL,
    to_emails           JSONB NOT NULL DEFAULT '[]'::jsonb,
    cc_emails           JSONB NOT NULL DEFAULT '[]'::jsonb,
    bcc_emails          JSONB NOT NULL DEFAULT '[]'::jsonb,
    subject             TEXT NOT NULL DEFAULT '',
    message_id          VARCHAR(255) NOT NULL DEFAULT '',
    text_content        TEXT,
    html_content        TEXT,
    attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_download_url    TEXT,
    raw_expires_at      TIMESTAMPTZ,
    payload_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_inbound_emails_received_at
ON platform_inbound_emails(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_inbound_emails_from
ON platform_inbound_emails(from_email, received_at DESC);

DROP TRIGGER IF EXISTS trg_auth_verification_challenges_updated_at ON auth_verification_challenges;
CREATE TRIGGER trg_auth_verification_challenges_updated_at
BEFORE UPDATE ON auth_verification_challenges
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_platform_inbound_emails_updated_at ON platform_inbound_emails;
CREATE TRIGGER trg_platform_inbound_emails_updated_at
BEFORE UPDATE ON platform_inbound_emails
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
