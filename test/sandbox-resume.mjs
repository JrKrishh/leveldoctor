// Debug: resume the paused sandbox and run a command.
import '../src/env.mjs'
import { readFile } from 'node:fs/promises'
import { CreateosSandboxClient } from '@nodeops-createos/sandbox'
const client = new CreateosSandboxClient({ apiKey: process.env.CREATEOS_SANDBOX_API_KEY, baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL || 'https://api-eu.sb.createos.sh' })
const sb = await client.getSandbox((await readFile('out/.sandbox-id', 'utf8')).trim())
console.log('before', sb.status)
const t0 = Date.now()
try { await sb.resume(); console.log('after resume', sb.status, Date.now() - t0, 'ms') } catch (e) { console.log('resume failed:', e.constructor.name, e.message) }
try { const { result } = await sb.runCommand('node', ['-v']); console.log('exec ok', result.stdout.trim()) } catch (e) { console.log('exec failed:', e.message) }
