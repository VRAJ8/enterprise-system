// Writes dist/_redirects for Netlify after the build.
// With API_URL set, /api/* is proxied to the API so its auth cookie stays first-party.
import { writeFileSync } from 'node:fs'

const api = process.env.API_URL?.replace(/\/$/, '')
const rules = []
if (api) rules.push(`/api/*  ${api}/api/:splat  200`)
else console.warn('API_URL is not set: the site will build, but it has no API to talk to.')
rules.push('/*  /index.html  200')
writeFileSync(new URL('../dist/_redirects', import.meta.url), rules.join('\n') + '\n')
