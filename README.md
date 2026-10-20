# EnvBao Admin

A browser-based admin UI for [OpenBao](https://openbao.org). Create users and tokens, tie them to individual secrets without hand-writing policy HCL, and see who has access to what in an Identity → Policy → Secret graph.

Licensed under the [BSD 3-Clause License](LICENSE).

The UI talks directly to the OpenBao HTTP API from the browser. There is no backend.

## What it does

- **Connect** with a token or a userpass login. Refuses sealed or uninitialised servers, and explains CORS and connection problems.
- **Identities**: create, edit and delete userpass users, identity entities (with userpass aliases) and groups; create, list and revoke tokens. A new token's value is shown once.
- **Secrets**: browse KV v2 mounts and paths (names only; secret values are never read) and see which identities can reach a secret, through which policy, with which capabilities.
- **Access**: from an identity's **Access** button, grant it capabilities on a secret path (globs allowed) or revoke them, without writing policy HCL.
- **Graph**: Identity → Policy → Path graph, filterable by identity and path. Click a policy→path edge to revoke that grant.

## Using it

1. **Connect**: enter the OpenBao URL and a token (or userpass credentials).
2. **Identities → Users** (or Entities / Groups): create someone.
3. Click **Access** on that row, pick a secrets engine, enter a secret path such as `app/*`, tick the capabilities and **Grant**. The path is a KV path *within the mount*; EnvBao writes the `data/` and `metadata/` policy paths for you.
4. Check the result under **Secrets** (select the secret) or **Graph**.

Your session lasts as long as the token. When it expires, is revoked, or OpenBao is sealed, you'll see a banner with a link to sign in again. Reloading the page signs you out: the token is only held in memory.

## Quick start with Docker

```sh
docker compose up --build
```

Open http://localhost:8080 and connect to `http://localhost:8200` with token `root`. This starts a throwaway in-memory OpenBao dev server (CORS pre-configured for the UI and for OpenBao's own web UI at `:8200`) and the UI. Not for production.

The stack also loads sample data from [`docker/seed.sh`](docker/seed.sh): five secrets under `secret/` (`app/`, `shared/`, `team-a/`), userpass users `alice`, `bob` and `carol` (password `password123`), entities for alice and bob, a `platform` group, a few grants, and a `ci-deploy` token. Edit the script to change it. If you already have the stack running, `docker compose down` first: the setup step only runs on a fresh start.

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

Least privilege for the account that uses the UI. The same policy is kept in [`docs/envbao-admin.hcl`](docs/envbao-admin.hcl), and the integration tests run every UI operation with only this policy, so it is known to be sufficient:

```hcl
# Least-privilege policy for the account that uses EnvBao Admin.
# Adjust "secret" if your KV v2 mount has a different path.

# Policies: list, read, create/update and delete (managed `envbao-*` and read-only viewing of the rest)
path "sys/policies/acl"   { capabilities = ["list"] }
path "sys/policies/acl/*" { capabilities = ["create", "read", "update", "delete"] }

# Userpass users
path "auth/userpass/users"   { capabilities = ["list"] }
path "auth/userpass/users/*" { capabilities = ["create", "read", "update", "delete"] }

# Identity entities, aliases and groups
path "identity/entity/name"        { capabilities = ["list"] }
path "identity/entity/name/*"      { capabilities = ["create", "read", "update", "delete"] }
path "identity/entity-alias"       { capabilities = ["create", "update"] }
path "identity/entity-alias/id/*"  { capabilities = ["read", "delete"] }
path "identity/group/name"         { capabilities = ["list"] }
path "identity/group/name/*"       { capabilities = ["create", "read", "update", "delete"] }

# Tokens: create, list (needs sudo in OpenBao), inspect and revoke by accessor
path "auth/token/create"          { capabilities = ["create", "update"] }
path "auth/token/accessors"       { capabilities = ["list", "sudo"] }
path "auth/token/lookup-accessor" { capabilities = ["update"] }
path "auth/token/revoke-accessor" { capabilities = ["update"] }

# Discovery: mounted auth methods and secrets engines, and KV v2 metadata for the secret browser
path "sys/auth"            { capabilities = ["read"] }
path "sys/mounts"          { capabilities = ["read"] }
path "secret/metadata/*"   { capabilities = ["list"] }
```

Notes:

- Listing token accessors needs `sudo` in OpenBao, so the Tokens tab needs it on `auth/token/accessors`.
- Creating **orphan** tokens (the "Orphan" checkbox) needs `sudo` on `auth/token/create`. It is deliberately not granted above; add `"sudo"` there if you want it.
- If your KV v2 mount is not `secret/`, change `secret/metadata/*`.
- The account can create policies and attach them to identities, which is effectively the power to grant access to anything. Treat it as an administrator.

### Admin login

```sh
bao policy write envbao-admin docs/envbao-admin.hcl
bao write auth/userpass/users/admin password=... token_policies=envbao-admin
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

nginx (the bundled [`nginx.conf`](nginx.conf), used by the Docker image, also sets security headers):

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

The OpenBao URL is entered on the Connect screen; there is no build-time or runtime configuration. Add the UI's origin to OpenBao's CORS allowed origins (see [CORS](#cors)).

The bundled `nginx.conf` sends a Content-Security-Policy. Its `connect-src` allows any `http:`/`https:` origin because the OpenBao address is chosen at runtime; if you always use one OpenBao, tighten `connect-src` to that address.

### Container image

```sh
docker build -t envbao-admin .
docker run -p 8080:80 envbao-admin
```

## Development

```sh
npm install
npm run dev               # http://localhost:5173
npm test                  # unit tests
npm run lint
npm run build
BAO_ADDR=http://127.0.0.1:8200 BAO_TOKEN=root npm run test:integration   # against a dev OpenBao
```

The integration tests need a dev server with userpass available (they enable it if missing) and a KV v2 mount at `secret/` (the dev-mode default). They create and delete their own uniquely named objects, but run them against a throwaway instance, not a real one.

CI runs on Gitea Actions (`.gitea/workflows/ci.yml`): lint, test and build, plus an integration job against an OpenBao dev container.

## Limitations

- **Browser-direct**: CORS must be enabled on OpenBao, and the token lives in the browser's memory (never written to storage). There is no server-side audit trail beyond OpenBao's own audit log.
- **Scope**: KV v2 only, and only userpass auth, tokens and identity entities/groups are managed.
- **Managed policies**: access is granted by writing one policy per user, entity or group, named `envbao-<kind>-<name>` (for example `envbao-user-alice`). If a managed policy is edited outside EnvBao (for example to add parameter constraints) it becomes read-only in the UI rather than being overwritten. All other policies are shown read-only. Policy names are lower-cased by OpenBao, so identities whose names differ only by case or punctuation would collide; EnvBao detects this and refuses to overwrite.
- **Tokens**: cannot be granted access after creation (OpenBao fixes a token's policies when it is created), so choose their policies when creating them. Tokens created by a token die with it unless created as orphans.
- **Grants** write `<mount>/data/...` rules for read/create/update/delete and `<mount>/metadata/...` for list. `patch`, `sudo` and the KV `delete`/`undelete`/`destroy` sub-paths are not offered.
- **Access model**: follows OpenBao's "most specific path wins" rule. Parameter constraints, control groups, MFA and templated paths are not evaluated (templated paths are approximated), so the access views can over-report for policies that use them; such policies are flagged.
- **Inheritance**: identity→policy edges and the Access panel show *effective* policies, including those a user inherits from an aliased entity and that entity's groups. Nested groups and non-userpass aliases are not followed.
- **Scale**: the graph and Access panel read every user, entity, group, token and policy on each load, with no pagination, so large instances may be slow.
- **Sessions**: tokens are not renewed automatically. When one expires you sign in again.
