import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { accessForPath } from '../model/graph'
import { resolveIdentities } from '../model/identities'
import { pathMatches } from '../model/policy'
import { BaoClient } from './bao'
import * as secrets from './secrets'
import * as tokens from './tokens'

const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const P = { rw: `it-sec-rw-${sfx}`, ro: `it-sec-ro-${sfx}`, deny: `it-sec-deny-${sfx}` }
const created: tokens.CreatedToken[] = []

const policy = (name: string, hcl: string) => client.request('PUT', `sys/policies/acl/${name}`, { policy: hcl })

beforeAll(async () => {
  await policy(P.rw, `path "secret/data/it-${sfx}/*" { capabilities = ["create", "read", "update"] }`)
  await policy(P.ro, `path "secret/data/it-${sfx}/+/pub" { capabilities = ["read", "list"] }`)
  await policy(P.deny, `path "secret/data/it-${sfx}/private" { capabilities = ["deny"] }`)
  await client.request('POST', `secret/data/it-${sfx}/app/db`, { data: { k: 'v' } })
  await client.request('POST', `secret/data/it-${sfx}/team/pub`, { data: { k: 'v' } })
  for (const [name, policies] of [
    ['a', [P.rw, P.ro]],
    ['b', [P.rw, P.deny]],
    ['c', [P.ro]],
  ] as const) {
    created.push(await tokens.createToken(client, { displayName: `it-${sfx}-${name}`, policies: [...policies], renewable: false, orphan: false }))
  }
})

afterAll(async () => {
  for (const t of created) await tokens.revokeToken(client, t.accessor).catch(() => {})
  for (const p of Object.values(P)) await client.request('DELETE', `sys/policies/acl/${p}`).catch(() => {})
  await client.request('DELETE', `secret/metadata/it-${sfx}/app/db`).catch(() => {})
  await client.request('DELETE', `secret/metadata/it-${sfx}/team/pub`).catch(() => {})
})

describe('secret browser API', () => {
  test('finds the KV v2 mount and lists folders before secrets', async () => {
    expect((await secrets.listKvMounts(client)).map((m) => m.path)).toContain('secret/')
    const top = await secrets.listSecrets(client, 'secret/', `it-${sfx}/`)
    expect(top.map((e) => [e.name, e.isFolder])).toEqual([
      ['app/', true],
      ['team/', true],
    ])
    const app = await secrets.listSecrets(client, 'secret/', `it-${sfx}/app/`)
    expect(app).toEqual([{ name: 'db', path: `it-${sfx}/app/db`, isFolder: false }])
  })
})

describe('access model vs sys/capabilities-self', () => {
  test.each([
    `it-${sfx}/app/db`,
    `it-${sfx}/private`,
    `it-${sfx}/team/pub`,
    `it-${sfx}/team/x/y`,
    `it-${sfx}/team`,
    `other-${sfx}/z`,
  ])('agrees for %s', async (secret) => {
    const names = await client.list('sys/policies/acl')
    const policies = await Promise.all(names.map(async (name) => ({ name, hcl: await secrets.readPolicyHcl(client, name) })))
    const identities = resolveIdentities({ users: [], entities: [], groups: [], tokens: await tokens.listTokens(client) })
    const path = secrets.dataPath('secret/', secret)
    const model = accessForPath(identities, policies, path, pathMatches)

    for (const t of created) {
      const info = await tokens.lookupAccessor(client, t.accessor)
      const real = await secrets.capabilitiesSelf(client.withToken(t.token), path)
      const predicted = [...new Set(model.filter((m) => m.identity.name === info.display_name).flatMap((m) => m.capabilities))]
      expect(predicted.length ? predicted.sort() : ['deny'], `${info.display_name} on ${path}`).toEqual([...real].sort())
    }
  })
})
