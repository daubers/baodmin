# Administrator guide

This guide is for the person who installs EnvBao Admin and prepares OpenBao for it. If you want to *use* the UI, see the [user guide](user-guide.md). The README has the short version of everything here.

## How it fits together

EnvBao Admin is a static single-page app. There is no server component and no database: your browser loads the page and then talks **directly** to the OpenBao HTTP API, using a token you sign in with. That has three consequences:

- OpenBao must allow the UI's origin with **CORS**.
- Every action is performed with, and limited by, the signed-in account's OpenBao policies. The UI cannot do anything that account could not do with the CLI.
- The token is held in the page's memory only. Reloading the page signs you out, and nothing is written to browser storage.

```
 browser ──(loads static files)──▶ nginx / any static host
    │
    └──(HTTP API, X-Vault-Token, CORS)──▶ OpenBao
```

## Prerequisites

- OpenBao 2.x, initialised and unsealed. (The UI refuses to connect to a sealed or uninitialised server and says so.)
- A KV v2 mount, normally `secret/`.
- The **userpass** auth method, if you want to manage users and sign in with a password.
- HTTPS for the UI and OpenBao in production. Browsers block an HTTPS page from calling an HTTP OpenBao.

## 1. Allow the UI's origin (CORS)

CORS is runtime configuration in OpenBao, not a listener setting:

```sh
bao write sys/config/cors \
  enabled=true \
  allowed_origins="https://envbao.example.com" \
  allowed_headers="X-Vault-Token,Content-Type"
```

`allowed_origins` is a comma-separated list of exact origins (scheme, host and port). Writing `sys/config/cors` **replaces the whole list**, so include every origin each time. Once CORS is enabled, OpenBao rejects any request whose `Origin` is not listed, including OpenBao's own web UI at `/ui`; add OpenBao's own address if you still use it.

| Where the UI runs | Origin to allow |
| --- | --- |
| `npm run dev` | `http://localhost:5173` |
| Docker image / compose | `http://localhost:8080` |
| Production | your UI's origin, e.g. `https://envbao.example.com` |
| OpenBao's own web UI | OpenBao's address, e.g. `http://localhost:8200` |

## 2. Enable what the UI manages

```sh
bao auth enable userpass
bao secrets enable -path=secret -version=2 kv    # skip if it already exists
```

Dynamic secrets engines are optional. Mount them with the CLI or from the UI (**Secrets → New secrets engine**):

```sh
bao secrets enable database
bao secrets enable ssh
bao secrets enable aws
```

Not every OpenBao build includes the AWS engine; if `bao secrets enable aws` reports `plugin not found in the catalog`, register the plugin first. The AWS screens follow the engine's documented API but have only been tested without a live AWS engine.

## 3. Create the administrator policy and login

The UI's account needs a policy. The least-privilege policy is [`envbao-admin.hcl`](envbao-admin.hcl) (it is also reproduced in the README), and the integration tests run every UI operation with only that policy.

```sh
bao policy write envbao-admin docs/envbao-admin.hcl
bao write auth/userpass/users/admin password='...' token_policies=envbao-admin
# or, for a token:
bao token create -policy=envbao-admin
```

Things to know about this policy:

- **It is an administrator.** The account can create policies and attach them to identities, which is effectively the power to grant access to anything. Protect it accordingly.
- **Mount rules are powerful.** `sys/mounts/*` lets the account create, tune and **delete** any secrets engine. Deleting a mount destroys everything in it and revokes its leases. Remove that block if mounts are managed somewhere else; the Secrets page then shows permission errors on New, Settings and Delete.
- **The `creds`, `sign` and `static-creds` lines let the account issue live logins, keys and certificates.** Delete them if the account should manage roles without being able to use them.
- **Mount names.** The policy uses the default mount names (`secret/`, `database/`, `ssh/`, `aws/`). If yours differ, repeat the relevant block with your mount path.
- **KV settings** (max versions, check-and-set) are changed through `<mount>/config`. The policy grants this for `secret/` only; add a rule for any other KV mount you want to configure.
- **Applying a new release does not update the policy.** The deploy ships the UI only. When a release adds features (v0.2.0 added mount management), re-apply `docs/envbao-admin.hcl` with `bao policy write` yourself.

### Delegating

You do not have to give everyone the full policy. Anything the signed-in account is denied simply shows OpenBao's permission error in the UI. A common split is a smaller policy for people who only manage roles and grants and never mounts or leases.

## 4. Deploy the UI

```sh
npm ci
npm run build
```

`dist/` is a static site. Serve it from any static host with a fallback to `index.html` for client-side routes, over HTTPS.

**Docker.** The release pipeline publishes `pkgs.daubney.dev/envbao/envbao-admin:<version>` and `:latest`. To build your own:

```sh
docker build -t envbao-admin .
docker run -p 8080:80 envbao-admin
```

**nginx / Caddy.** See the README for sample configs. The bundled [`nginx.conf`](../nginx.conf) also sets security headers, including a Content-Security-Policy whose `connect-src` allows any `http:`/`https:` origin, because the OpenBao address is typed on the Connect screen. If you only ever use one OpenBao, tighten `connect-src` to its address.

There is no build-time or runtime configuration; the OpenBao URL is entered at sign-in.

## 5. Releases and the deploy pipeline

Releases are driven by tags in the `envbao-admin` repository:

1. Bump the version (`package.json`, `package-lock.json`) in a "Release vX.Y.Z" commit and tag it `vX.Y.Z`.
2. Pushing the tag runs `.gitea/workflows/release.yml`: lint, audit, unit tests and build; integration tests against OpenBao and Postgres service containers; then the image build and push; then a dispatch to the `EnvBaoAdminDeploy` repository, which runs its Ansible playbook against the host (Docker Compose in `/opt/envbao-admin`).
3. Tags containing a `-` (pre-releases) build the image but do not deploy.

If a release did not deploy, open the run in the Gitea Actions tab: the integration job is the usual place for a release to stop, and a failure there skips the image and the deploy. The deploy can be run by hand from the deploy repository's Actions tab with the tag as input.

Required secrets: in `envbao-admin`, `PKGS_USER`, `PKGS_PASSWORD` and `DEPLOY_DISPATCH_TOKEN` (a token that may run workflows in the deploy repository); in `EnvBaoAdminDeploy`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `PKGS_USER`, `PKGS_PASSWORD` and optionally `NOTIFY_*`.

## Security notes

- **Token handling.** The token lives in memory only and is sent only to the OpenBao URL you entered. Anyone who can run script in the page (an XSS bug, a malicious browser extension) could use it, so keep the CSP and serve the UI from a dedicated origin.
- **Credentials shown once.** Tokens and dynamic credentials appear when created and are never stored or cached by the UI. Password and private-key fields in configuration forms are write-only.
- **Secret values are never read.** The Secrets page lists names and metadata only. It cannot display KV secret values.
- **Audit.** The UI has no audit trail of its own. Turn on an OpenBao audit device; every UI action appears there under the signed-in account.
- **Session length.** Sessions last as long as the token. Give the admin account a short TTL if you want people to sign in more often.
- **Managed policies.** Grants are stored as policies named `envbao-<kind>-<name>` with an `# envbao-owner:` header. If someone edits one outside EnvBao, the UI treats it as read-only rather than overwrite it. Other policies are shown read-only.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "Cannot reach OpenBao" or a CORS message on Connect | The UI's origin is not in `sys/config/cors`, or the URL is wrong, or an HTTPS page is calling an HTTP OpenBao. |
| OpenBao's own `/ui` stopped working after enabling CORS | Add OpenBao's own address to `allowed_origins`. |
| "Server is sealed" / "not initialised" | Unseal or initialise OpenBao. |
| Permission denied on New / Settings / Delete (Secrets) | The account's policy lacks `sys/mounts/*`. Re-apply `envbao-admin.hcl`. |
| Permission denied on Leases | Listing leases and revoking by prefix need `sudo` on `sys/leases/lookup/*` and `sys/leases/revoke-prefix/*`. The shipped policy includes it. |
| Token list is empty or incomplete | Listing token accessors needs `sudo` in OpenBao; the shipped policy includes it. |
| A banner says the session has expired | The token expired, was revoked, or OpenBao sealed. Sign in again. |
| A policy is read-only in the UI | It is not an EnvBao-managed policy, or it was edited outside EnvBao. Edit it with the CLI. |
| Mount created but "saving KV settings failed" | The account may change `sys/mounts` but not `<mount>/config`. Add a `config` rule for that mount. |
| A new release is out but nothing changed | Check the release run and the deploy run in Gitea Actions; the UI can also be cached, so hard-reload. |

## Trying it out: the demo stack

```sh
docker compose up --build
```

Open http://localhost:8080 and connect to `http://localhost:8200` with token `root`. This starts a throwaway in-memory OpenBao dev server, a Postgres and an SSH server wired to the database and SSH engines, and the UI, loaded with sample data from `docker/seed.sh` (users `alice`, `bob` and `carol`, password `password123`). It is not for production. The screenshots in these guides were taken from it.
