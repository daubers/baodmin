import { expect, test } from 'vitest'
import { maskConnectionUrl } from './connectionUrl'

test('keeps templated credentials', () => {
  const u = 'postgresql://{{username}}:{{password}}@db:5432/app?sslmode=disable'
  expect(maskConnectionUrl(u)).toBe(u)
})

test('hides a literal password in the userinfo', () => {
  expect(maskConnectionUrl('postgresql://bao:hunter2@db:5432/app')).toBe('postgresql://bao:••••@db:5432/app')
  expect(maskConnectionUrl('mongodb+srv://u:p%40ss@cluster.example.test/x')).toBe('mongodb+srv://u:••••@cluster.example.test/x')
})

test('hides a literal password parameter, in either style', () => {
  expect(maskConnectionUrl('postgresql://db/app?user=bao&password=hunter2&sslmode=disable')).toBe(
    'postgresql://db/app?user=bao&password=••••&sslmode=disable',
  )
  expect(maskConnectionUrl('host=db user=bao password=hunter2 dbname=app')).toBe('host=db user=bao password=•••• dbname=app')
})

test('leaves URLs without credentials alone', () => {
  expect(maskConnectionUrl('postgresql://db:5432/app')).toBe('postgresql://db:5432/app')
  expect(maskConnectionUrl('')).toBe('')
})
