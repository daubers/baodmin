import {
  managedPolicyName,
  ownerTag,
  parseManagedPolicy,
  removeGrant,
  renderManagedPolicy,
  upsertGrant,
  validateGrantPath,
  type Grant,
  type GrantTarget,
  type ManagedPolicy,
} from '../model/managed'
import type { BaoClient } from './bao'
import { readEntity, readGroup, readUser, saveEntity, saveGroup, saveUser } from './identities'
import { readPolicyHcl } from './secrets'

export interface Target {
  kind: GrantTarget
  name: string
}

export interface GrantState {
  policyName: string
  /** Raw HCL of the managed policy, or null if there is none yet. */
  hcl: string | null
  managed: ManagedPolicy | null
  attached: boolean
  /** Policies on the identity that EnvBao does not manage (shown read-only). */
  otherPolicies: string[]
}

async function attachedPolicies(c: BaoClient, t: Target): Promise<string[]> {
  if (t.kind === 'user') return (await readUser(c, t.name)).policies
  if (t.kind === 'entity') return (await readEntity(c, t.name)).policies
  return (await readGroup(c, t.name)).policies
}

/** Re-read, change and write back the identity's policy list, preserving its other settings. */
async function updateAttached(c: BaoClient, t: Target, change: (p: string[]) => string[]): Promise<void> {
  if (t.kind === 'user') {
    const u = await readUser(c, t.name)
    await saveUser(c, { name: t.name, policies: change(u.policies) })
  } else if (t.kind === 'entity') {
    const e = await readEntity(c, t.name)
    await saveEntity(c, { name: t.name, policies: change(e.policies), disabled: e.disabled })
  } else {
    const g = await readGroup(c, t.name)
    await saveGroup(c, { name: t.name, policies: change(g.policies), memberEntityIds: g.member_entity_ids })
  }
}

export async function getGrantState(c: BaoClient, t: Target): Promise<GrantState> {
  const policyName = managedPolicyName(t.kind, t.name)
  const [hcl, policies] = await Promise.all([readPolicyHcl(c, policyName), attachedPolicies(c, t)])
  return {
    policyName,
    hcl,
    managed: hcl === null ? null : parseManagedPolicy(hcl),
    attached: policies.includes(policyName),
    otherPolicies: policies.filter((p) => p !== policyName),
  }
}

async function loadEditable(c: BaoClient, t: Target): Promise<{ policyName: string; grants: Grant[] }> {
  const policyName = managedPolicyName(t.kind, t.name)
  const hcl = await readPolicyHcl(c, policyName)
  if (hcl === null) return { policyName, grants: [] }
  const m = parseManagedPolicy(hcl)
  // The name is lossy (case/punctuation), so make sure we never clobber another identity's policy.
  if (m.owner !== ownerTag(t.kind, t.name)) {
    throw new Error(`Policy "${policyName}" exists but is not managed by EnvBao for ${t.kind} "${t.name}".`)
  }
  if (!m.editable) throw new Error(`Policy "${policyName}" was edited outside EnvBao and cannot be changed here: ${m.reasons.join('; ')}`)
  return { policyName, grants: m.grants }
}

async function writePolicy(c: BaoClient, name: string, hcl: string): Promise<void> {
  await c.request('PUT', `sys/policies/acl/${encodeURIComponent(name)}`, { policy: hcl })
}

/** Add or replace grants (by path) on the identity's managed policy, and attach it. */
export async function grantAccess(c: BaoClient, t: Target, rules: Grant[]): Promise<void> {
  for (const r of rules) {
    const err = validateGrantPath(r.path)
    if (err) throw new Error(err)
  }
  const { policyName, grants } = await loadEditable(c, t)
  const next = rules.reduce(upsertGrant, grants)
  if (next.length === 0) throw new Error('Select at least one capability.')
  await writePolicy(c, policyName, renderManagedPolicy(t.kind, t.name, next))
  await updateAttached(c, t, (p) => (p.includes(policyName) ? p : [...p, policyName]))
}

/** Remove grants by path. When none remain, the policy is detached and deleted. */
export async function revokeAccess(c: BaoClient, t: Target, paths: string[]): Promise<void> {
  const { policyName, grants } = await loadEditable(c, t)
  const next = paths.reduce(removeGrant, grants)
  if (next.length === 0) {
    await updateAttached(c, t, (p) => p.filter((n) => n !== policyName))
    await c.request('DELETE', `sys/policies/acl/${encodeURIComponent(policyName)}`)
  } else {
    await writePolicy(c, policyName, renderManagedPolicy(t.kind, t.name, next))
  }
}
