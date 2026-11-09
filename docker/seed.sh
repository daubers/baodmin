#!/bin/sh
# Sample data for the docker-compose demo. Throwaway: the dev server is in-memory, so this
# runs fresh on every `docker compose up`. All passwords and secret values here are fake.
# Expects BAO_ADDR and BAO_TOKEN in the environment.
set -eu

# Allow the UI origin to call OpenBao from the browser. OpenBao's own web UI (:8200) is
# same-origin but still sends an Origin header, so it is listed too.
bao write sys/config/cors enabled=true \
  allowed_origins="http://localhost:8080,http://localhost:8200" \
  allowed_headers="X-Vault-Token,Content-Type"

# Compose re-runs this when other services are rebuilt; don't load the data twice.
if bao read sys/auth/userpass >/dev/null 2>&1; then
  echo "Sample data already loaded."
  exit 0
fi

# --- Secrets (KV v2 at secret/ is mounted by dev mode) ---
put() { path=$1; shift; bao kv put "secret/$path" "$@" >/dev/null; }
put app/database host=db.internal user=app password=sample-not-a-real-secret
put app/api-keys stripe=sk_test_sample sendgrid=SG.sample
put shared/smtp host=smtp.internal user=mailer password=sample-not-a-real-secret
put team-a/deploy ssh_key=sample-not-a-real-key
put team-a/staging/database host=staging-db.internal password=sample-not-a-real-secret

# --- Policies ---
# The envbao-* ones are written the way EnvBao writes them (see src/model/managed.ts), so
# they show up as editable grants in the Access panel and in the graph.
bao policy write envbao-user-alice - >/dev/null <<'POLICY'
# Managed by EnvBao. Changes made outside EnvBao may be overwritten.
# envbao-owner: user:alice

path "secret/data/team-a/*" {
  capabilities = ["read", "update"]
}
path "secret/metadata/team-a/*" {
  capabilities = ["list"]
}
path "database/creds/readonly" {
  capabilities = ["read"]
}
path "ssh/sign/demo" {
  capabilities = ["update"]
}
POLICY

bao policy write envbao-user-bob - >/dev/null <<'POLICY'
# Managed by EnvBao. Changes made outside EnvBao may be overwritten.
# envbao-owner: user:bob

path "secret/data/shared/smtp" {
  capabilities = ["read"]
}
POLICY

bao policy write envbao-group-platform - >/dev/null <<'POLICY'
# Managed by EnvBao. Changes made outside EnvBao may be overwritten.
# envbao-owner: group:platform

path "secret/data/app/*" {
  capabilities = ["read"]
}
path "secret/metadata/app/*" {
  capabilities = ["list"]
}
path "database/creds/*" {
  capabilities = ["read"]
}
POLICY

# Hand-written, so EnvBao shows it read-only.
bao policy write ops-readonly - >/dev/null <<'POLICY'
path "sys/health" {
  capabilities = ["read"]
}
path "secret/metadata/*" {
  capabilities = ["list"]
}
POLICY

# --- Users ---
bao auth enable userpass >/dev/null
bao write auth/userpass/users/alice password=password123 policies=envbao-user-alice >/dev/null
bao write auth/userpass/users/bob password=password123 policies=envbao-user-bob >/dev/null
bao write auth/userpass/users/carol password=password123 policies=ops-readonly >/dev/null

# --- Entities, aliases and a group ---
accessor=$(bao read -field=accessor sys/auth/userpass)
alice_id=$(bao write -field=id identity/entity name=alice)
bob_id=$(bao write -field=id identity/entity name=bob)
bao write identity/entity-alias name=alice canonical_id="$alice_id" mount_accessor="$accessor" >/dev/null
bao write identity/entity-alias name=bob canonical_id="$bob_id" mount_accessor="$accessor" >/dev/null
bao write identity/group name=platform member_entity_ids="$alice_id" policies=envbao-group-platform >/dev/null

# --- A token ---
bao token create -display-name=ci-deploy -policy=envbao-user-bob -ttl=24h >/dev/null

# --- Dynamic secrets: database (Postgres service "postgres", see docker/postgres/init.sql) ---
bao secrets enable database >/dev/null
bao write database/config/app \
  plugin_name=postgresql-database-plugin \
  allowed_roles="readonly,readwrite,app-static" \
  connection_url="postgresql://{{username}}:{{password}}@postgres:5432/app?sslmode=disable" \
  username=openbao password=openbao-sample >/dev/null

# Statements are JSON on stdin because they contain quotes and semicolons.
bao write database/roles/readonly - >/dev/null <<'JSON'
{
  "db_name": "app",
  "creation_statements": [
    "CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';",
    "GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";"
  ],
  "default_ttl": "1h",
  "max_ttl": "24h"
}
JSON
bao write database/roles/readwrite - >/dev/null <<'JSON'
{
  "db_name": "app",
  "creation_statements": [
    "CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";",
    "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\";"
  ],
  "default_ttl": "1h",
  "max_ttl": "8h"
}
JSON
# A fixed login whose password OpenBao rotates, rather than a new login per request.
bao write database/static-roles/app-static db_name=app username=app_static rotation_period=24h >/dev/null

# --- Dynamic secrets: SSH certificates (the "sshd" service trusts this CA) ---
bao secrets enable ssh >/dev/null
bao write ssh/config/ca generate_signing_key=true >/dev/null
bao write ssh/roles/demo - >/dev/null <<'JSON'
{
  "key_type": "ca",
  "allow_user_certificates": true,
  "allowed_users": "deploy,alice",
  "default_user": "deploy",
  "default_extensions": { "permit-pty": "" },
  "ttl": "30m",
  "max_ttl": "4h"
}
JSON

# A couple of live leases so the Leases tab has something to show (credentials discarded).
bao read database/creds/readonly >/dev/null
bao read database/creds/readwrite >/dev/null

echo "Sample data loaded. Sign in as alice, bob or carol with password: password123"
echo "Dynamic engines: database/ (Postgres) and ssh/ (certificates for the sshd service, port 2222)."
