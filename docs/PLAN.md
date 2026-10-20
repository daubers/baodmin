# EnvBao Admin UI — Plan (YouTrack project ENB)

## Context
EnvBao needs an admin UI over an OpenBao instance so users/tokens can be created and tied to individual secrets without hand-writing policy HCL, plus a graph showing who has access to what. `envbao-admin` is a fresh Vite + React 19 + TypeScript 6 template (oxlint, no router/state/UI libs). `bao` CLI is installed locally (/opt/homebrew/bin/bao) for a dev server. ENB in YouTrack (pm.daubney.dev) is empty and requires login; issues will be created from the milestones below.

## Decisions (confirmed)
- Browser talks directly to OpenBao HTTP API (needs CORS: `bao` listener config / `/sys/config/cors`); user's token kept in memory (sessionStorage optional).
- Identities: userpass users + identity entities/groups, AND standalone tokens.
- Graph: Identity → Policy → Secret path, edges labelled with capabilities (read/list/create/update/delete).

## Architecture
- `src/api/bao.ts`: typed fetch client (`X-Vault-Token`, base URL config, error mapping). Endpoints: `sys/policies/acl`, `auth/userpass/users`, `auth/token/create|lookup|accessors`, `identity/entity|group`, `sys/mounts`, `secret/metadata` (KV v2), `sys/capabilities`.
- `src/model/`: `buildAccessGraph()` — parses ACL policy HCL path rules into `{path, capabilities}`, joins with identities' attached policies → nodes/edges. Pure and unit-testable.
- Managed-policy convention: UI generates one policy per (identity, secret path set) named `envbao-<identity>`, so grants are editable via a simple "secret path + capability checkboxes" form rather than raw HCL (raw HCL view available).
- UI libs: React Router, TanStack Query (server state), `@xyflow/react` (React Flow) + dagre layout for graph, Vitest for tests.

## Screens
1. Connect: OpenBao URL + token login (also userpass login); health/seal status.
2. Identities: list/create/delete users and tokens (TTL, policies, renewable, display name); show token once on creation.
3. Secrets: browse KV mounts/paths; per-secret "Access" panel listing who can reach it.
4. Grant dialog: pick identity → pick secret path(s) (glob supported) → capabilities → writes/updates policy and attaches it.
5. Access Graph: three-column graph (identities | policies | secret paths), filter by identity/path, click node → details, click edge → revoke.

## Repo, licence, CI (confirmed)
- `git init` in `/Users/matt/WebstormProjects/envbao-admin`, branch `main`, remote `origin` = `ssh://git@git.daubney.dev:222/matt/envbao-admin.git`; initial commit of the Vite template (node_modules already ignored) and push.
- `LICENSE`: BSD 3-Clause, copyright holder Matt Daubney (to confirm), `"license": "BSD-3-Clause"` in package.json, noted in README.
- Gitea Actions in `.gitea/workflows/`:
  - `ci.yml` (push + PR): checkout, setup-node 22, `npm ci`, `npm run lint`, `npm test`, `npm run build`; upload `dist` artifact.
  - Integration job: start `bao server -dev` as a service/container and run API-client tests against it.
  - Optional later: `release.yml` on tags to build a container image.
  - Needs a Gitea runner registered (verify one exists).

## README.md (replace the Vite template text)
Must cover:
- Overview and BSD-3 licence.
- **OpenBao setup**: enabling CORS for the UI origin, enabling userpass auth and a KV v2 mount, an admin policy for the UI (least privilege: `sys/policies/acl/*`, `auth/userpass/users/*`, `auth/token/create`, `identity/*`, `sys/mounts` read, `secret/metadata/*` list), creating an admin token/login, dev-mode quickstart.
- **Deployment**: `npm run build` static `dist/`, serving via nginx/Caddy (example config, SPA fallback), HTTPS requirement, env/runtime config for OpenBao URL, optional container image, Gitea CI notes.
- **Limitations**: browser-direct means CORS required and the token lives in the browser; no server-side audit trail beyond OpenBao's own; KV v2 only; only userpass auth and token/identity entities supported; policies not created by the UI (not `envbao-` managed) are shown read-only in the graph; glob/templated policy paths approximated; large instances may be slow (no pagination of graph).
README writing is part of the repo-setup ticket and finalised in the hardening ticket.

## YouTrack tickets (project ENB, created via youtrack MCP after approval)
Epic-style parent "EnvBao Admin UI" plus these issues, each with description and acceptance criteria, linked as subtasks:
1. Repo setup: git init, remote, BSD-3 LICENSE, README
2. Gitea CI: lint/test/build pipeline (+ OpenBao integration job)
3. Tooling: Vitest, React Router, TanStack Query, project structure
4. OpenBao API client + connect/login screen (CORS docs)
5. Policy HCL parser + access-graph model (+ unit tests)
6. Identity management: userpass users, entities/groups
7. Token management: create/list/revoke, show-once secret
8. Secret browser (KV v2) with per-secret Access panel
9. Grant/revoke flow (managed policies per identity)
10. Access Graph view (Identity → Policy → Secret, React Flow)
11. Hardening: error states, token expiry, README/user docs

## Verification
- Run local dev OpenBao (`bao server -dev -dev-root-token-id=root`, CORS enabled), seed with a KV mount, 2 users, 1 token, policies.
- Unit tests for HCL parsing/graph building (`vitest`).
- Manually run `npm run dev` and verify via browser pane: create user → grant secret → graph shows edge → `bao` CLI login as user confirms capability; revoke removes edge and access.
- `npm run lint` and `npm run build` pass.
