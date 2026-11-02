-- Защищённый буфер обмена (E2EE). Сервер хранит только шифротекст и конверты ключей.
-- ВНИМАНИЕ: на продакшн применяется только с разрешения владельца.
CREATE TABLE IF NOT EXISTS clipboard_vaults (
  user_id bigint PRIMARY KEY,
  vault_version integer NOT NULL DEFAULT 1 CHECK (vault_version >= 1),
  key_envelope_version integer NOT NULL DEFAULT 1 CHECK (key_envelope_version >= 1),
  recovery_enabled boolean NOT NULL DEFAULT false,
  -- Конверт Vault Key, зашифрованный recovery-ключом (AES-GCM). Без recovery-ключа сервер не читает.
  recovery_envelope text,
  recovery_iv text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clipboard_devices (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES clipboard_vaults (user_id) ON DELETE CASCADE,
  public_key text NOT NULL,
  -- ECDH-конверт Vault Key для этого устройства (ephemeral pub + iv + ciphertext). NULL = ожидает подтверждения.
  wrapped_vault_key text,
  wrap_iv text,
  wrap_eph_pub text,
  device_name text NOT NULL DEFAULT '' CHECK (char_length(device_name) <= 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'trusted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS clipboard_devices_user_idx ON clipboard_devices (user_id, status);

CREATE TABLE IF NOT EXISTS clipboard_entries (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES clipboard_vaults (user_id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  encrypted_dek text NOT NULL,
  iv text NOT NULL,
  dek_iv text NOT NULL,
  format_version integer NOT NULL DEFAULT 1 CHECK (format_version >= 1),
  pinned boolean NOT NULL DEFAULT false,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 200000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clipboard_entries_user_created_idx ON clipboard_entries (user_id, pinned DESC, created_at DESC);
