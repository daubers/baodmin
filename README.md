# EnvBao Admin

A browser-based admin UI for [OpenBao](https://openbao.org). Create users and tokens, tie them to individual secrets without hand-writing policy HCL, and see who has access to what in an Identity → Policy → Secret graph.

Licensed under the [BSD 3-Clause License](LICENSE).

The UI talks directly to the OpenBao HTTP API from the browser. There is no backend.

## Quick start with Docker

```sh
docker compose up --build
```

Open http://localhost:8080 and connect to `http://localhost:8200` with token `root`. This starts a throwaway in-memory OpenBao dev server (CORS pre-configured for the UI and for OpenBao's own web UI at `:8200`) and the UI. Not for production.

To run just the UI image: `docker build -t envbao-admin . && docker run -p 8080:80 envbao-admin`.

## OpenBao setup

### Quickstart (dev mode)

```sh
bao server -dev -dev-root-token-id=root
export BAO_ADDR=http://127.0.0.1:8200
export BAO_TOKEN=root
```

Dev mode already mounts `secret/` as KV v2. Then enable CORS and userpass (below) and run `npm install && npm run dev`.

### CORS

The browser calls OpenBao directly, so OpenBao must allow the UI's origin. CORS is configured at runtime through the API (it is not a listener setting):

```sh
bao write sys/config/cors \
  enabled=true \
  allowed_origins="http://localhost:5173" \
  allowed_headers="X-Vault-Token,Content-Type"
```

`allowed_origins` is a comma-separated list of exact origins (scheme + host + port):

| Where the UI runs | Origin to allow |
| --- | --- |
| `npm run dev` | `http://localhost:5173` |
| Docker image / compose | `http://localhost:8080` |
| Production | your real UI origin, e.g. `https://envbao.example.com` |
| OpenBao's own web UI (`/ui`), if you also use it | OpenBao's own address, e.g. `http://localhost:8200` |

The last row is easy to miss: once CORS is enabled, OpenBao rejects any request whose `Origin` is not listed, including requests from its own web UI, which fails with "origin not allowed". For example, to use both the admin UI from `npm run dev` and OpenBao's own UI:

```sh
bao write sys/config/cors enabled=true \
  allowed_origins="http://localhost:5173,http://localhost:8200" \
  allowed_headers="X-Vault-Token,Content-Type"
```

Writing `sys/config/cors` replaces the whole list, so include every origin each time.

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

The OpenBao URL is entered on the Connect screen. Add the UI's origin to OpenBao's CORS allowed origins (see [CORS](#cors)).

CI runs on Gitea Actions (`.gitea/workflows/`): lint, test, build.

## Limitations

- Browser-direct access means CORS must be enabled on OpenBao, and the token lives in the browser (in memory; sessionStorage optional).
- No server-side audit trail beyond OpenBao's own audit log.
- KV v2 only.
- Only userpass auth, tokens and identity entities/groups are supported.
- Access is granted by writing one managed policy per user, entity or group, named `envbao-<kind>-<name>` (for example `envbao-user-alice`). A managed policy that is edited outside EnvBao becomes read-only in the UI. Other policies are always shown read-only.
- Tokens cannot be granted access after creation (OpenBao fixes a token's policies when it is created), so choose their policies when creating them.
- Grants are KV v2 only: they write `<mount>/data/...` rules for read/create/update/delete and `<mount>/metadata/...` for list.
- The access model follows OpenBao's "most specific path wins" rule, so a broader rule never adds to or overrides a more specific one.
- Glob and templated policy paths are approximated.
- The graph is not paginated, so large instances may be slow.
