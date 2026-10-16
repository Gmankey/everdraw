#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const artifactDir = path.resolve(process.argv[2] || process.env.V5_RELEASE_ARTIFACT_DIR || 'dist')
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs', '.txt', '.webmanifest', '.xml'])
const forbidden = [
  { label: 'Monad Alchemy endpoint', pattern: /monad[^"'\s]*\.alchemy\.com/i },
  { label: 'credential-bearing RPC path', pattern: /https?:[^"'\s]+(?:\/|\\u002f)v2(?:\/|\\u002f)[a-z0-9_-]{8,}/i },
]

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(absolute) : [absolute]
  })
}

if (!fs.existsSync(artifactDir) || !fs.statSync(artifactDir).isDirectory()) {
  throw new Error(`Missing release artifact directory: ${artifactDir}`)
}

const violations = []
for (const file of filesUnder(artifactDir)) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue
  const contents = fs.readFileSync(file, 'utf8')
  for (const check of forbidden) {
    if (check.pattern.test(contents)) violations.push(`${path.relative(artifactDir, file)}: ${check.label}`)
  }
}
if (violations.length) {
  console.error('[v5-release-artifact] forbidden RPC material found (values redacted)')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`[v5-release-artifact] scanned ${artifactDir}; no credential-bearing RPC found`)
