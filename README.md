# EnvBao Admin

A browser-based admin UI for [OpenBao](https://openbao.org). Create users and tokens, tie them to individual secrets without hand-writing policy HCL, and see who has access to what in an Identity → Policy → Secret graph.

Licensed under the [BSD 3-Clause License](LICENSE).

The UI talks directly to the OpenBao HTTP API from the browser. There is no backend.

## OpenBao setup

### Quickstart (dev mode)

```sh
bao server -dev -dev-root-token-id=root
export BAO_ADDR=http://127.0.0.1:8200
export BAO_TOKEN=root
```

Dev mode already mounts `secret/` as KV v2. Then enable CORS and userpass (below) and run `npm install && npm run dev`.

### CORS

The browser must be allowed to call OpenBao from the UI's origin. Either set it in the server config:

```hcl
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = false
  # ...
}
```

and then configure CORS at runtime:

```sh
bao write sys/config/cors \
  enabled=true \
  allowed_origins="http://localhost:5173" \
  allowed_headers="X-Vault-Token,Content-Type"
```

Use your real UI origin in production.

### Auth method and secrets engine

```sh
bao auth enable userpass
bao secrets enable -path=secret -version=2 kv   # skip if already mounted
```

### Admin policy for the UI

Least privilege for the account that uses the UI:

```hcl
path "sys/policies/acl/*"      { capabilities = ["create", "read", "update", "delete", "list"] }
path "sys/policies/acl"        { capabilities = ["list"] }
path "auth/userpass/users/*"   { capabilities = ["create", "read", "update", "delete", "list"] }
path "auth/userpass/users"     { capabilities = ["list"] }
path "auth/token/create"       { capabilities = ["create", "update"] }
path "auth/token/lookup"       { capabilities = ["update"] }
path "auth/token/accessors"    { capabilities = ["list"] }
path "auth/token/revoke-accessor" { capabilities = ["update"] }
path "identity/*"              { capabilities = ["create", "read", "update", "delete", "list"] }
path "sys/mounts"              { capabilities = ["read"] }
path "secret/metadata/*"       { capabilities = ["list"] }
path "sys/capabilities"        { capabilities = ["update"] }
```

### Admin login

```sh
bao policy write envbao-admin envbao-admin.hcl
bao write auth/userpass/users/admin password=... policies=envbao-admin
# or
bao token create -policy=envbao-admin
```

Log in to the UI with either the userpass credentials or the token.

## Deployment

```sh
npm ci
npm run build
```

This produces a static `dist/` directory. Serve it with any static host, with an SPA fallback to `index.html`. Use HTTPS: the OpenBao token is held in the browser, and browsers block mixed content from an HTTPS page to an HTTP OpenBao.

nginx:

```nginx
server {
  listen 443 ssl;
  server_name envbao.example.com;
  root /srv/envbao-admin/dist;
  location / { try_files $uri /index.html; }
}
```

Caddy:

```caddyfile
envbao.example.com {
  root * /srv/envbao-admin/dist
  try_files {path} /index.html
  file_server
}
```

The OpenBao URL is entered on the Connect screen. Add the UI's origin to OpenBao's CORS allowed origins.

CI runs on Gitea Actions (`.gitea/workflows/`): lint, test, build.

## Limitations

- Browser-direct access means CORS must be enabled on OpenBao, and the token lives in the browser (in memory; sessionStorage optional).
- No server-side audit trail beyond OpenBao's own audit log.
- KV v2 only.
- Only userpass auth, tokens and identity entities/groups are supported.
- Policies not created by the UI (not named `envbao-*`) are shown read-only in the graph.
- Glob and templated policy paths are approximated.
- The graph is not paginated, so large instances may be slow.
