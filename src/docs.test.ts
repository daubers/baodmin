import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('README embeds the tested admin policy verbatim', () => {
  const policy = readFileSync('docs/envbao-admin.hcl', 'utf8').trim()
  expect(readFileSync('README.md', 'utf8')).toContain(policy)
})

test('README documents every origin the docker-compose setup allows', () => {
  const seed = readFileSync('docker/seed.sh', 'utf8')
  const origins = /allowed_origins="([^"]+)"/.exec(seed)![1].split(',')
  const readme = readFileSync('README.md', 'utf8')
  for (const o of origins) expect(readme).toContain(o)
})
