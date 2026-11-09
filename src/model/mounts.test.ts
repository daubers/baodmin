import { expect, test } from 'vitest'
import { policiesReferencing, validateMountPath } from './mounts'

const existing = ['secret/', 'database/', 'team/kv/']

test('accepts ordinary and nested paths, with or without slashes', () => {
  for (const p of ['scratch', 'my-store_2', 'scratch/', 'apps/payments', '9lives']) expect(validateMountPath(p, existing), p).toBeNull()
})

test('rejects empty, oddly-formed and uppercase paths', () => {
  expect(validateMountPath('', existing)).toBe('Path is required.')
  expect(validateMountPath('/', existing)).toBe('Path is required.')
  expect(validateMountPath(' x', existing)).toMatch(/spaces/)
  for (const p of ['My Store', 'Upper', 'a//b', '-lead', 'dot.ted', 'a/_b', 'ünï']) expect(validateMountPath(p, existing), p).toMatch(/lowercase/)
})

test('rejects the names OpenBao reserves, also as a prefix', () => {
  for (const p of ['sys', 'auth', 'identity', 'cubbyhole', 'sys/x', 'auth/kv']) expect(validateMountPath(p, existing), p).toMatch(/reserved/)
})

test('rejects a path equal to, inside or containing an existing mount', () => {
  expect(validateMountPath('secret', existing)).toMatch(/already a secrets engine/)
  expect(validateMountPath('secret/', existing)).toMatch(/already/)
  expect(validateMountPath('secret/inner', existing)).toMatch(/inside the existing mount "secret\/"/)
  expect(validateMountPath('team', existing)).toMatch(/contain the existing mount "team\/kv\/"/)
  expect(validateMountPath('secrets', existing)).toBeNull() // shares a prefix, not a path segment
})

test('finds policies with rules under a mount, however the mount is written', () => {
  const policies = [
    { name: 'b-uses', hcl: 'path "secret/data/app/*" { capabilities = ["read"] }' },
    { name: 'a-uses', hcl: 'path "secret/metadata/*" { capabilities = ["list"] }\npath "x/y" { capabilities = ["read"] }' },
    { name: 'other', hcl: 'path "secrets/data/x" { capabilities = ["read"] }' },
    { name: 'unreadable', hcl: null },
    { name: 'broken', hcl: 'path "secret/x" {' },
  ]
  expect(policiesReferencing(policies, 'secret/')).toEqual(['a-uses', 'b-uses'])
  expect(policiesReferencing(policies, 'secret')).toEqual(['a-uses', 'b-uses'])
  expect(policiesReferencing(policies, 'nothing/')).toEqual([])
})
