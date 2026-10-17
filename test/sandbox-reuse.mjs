// Debug: why does reusing the saved sandbox fail? Prints each step's result.
import '../src/env.mjs'
import { readFile } from 'node:fs/promises'
import { CreateosSandboxClient } from '@nodeops-createos/sandbox'

const client = new CreateosSandboxClient({ apiKey: process.env.CREATEOS_SANDBOX_API_KEY, baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL || 'https://api-eu.sb.createos.sh' })
const id = (await readFile('out/.sandbox-id', 'utf8')).trim()
console.log('saved id', id)
try { const sb = await client.getSandbox(id); console.log('status', sb.status); try { console.log('egress', JSON.stringify(await sb.getEgress())) } catch (e) { console.log('getEgress failed:', e.message) }
  try { console.log('setEgress', JSON.stringify(await sb.setEgress(['egress-blocked.invalid:443']))) } catch (e) { console.log('setEgress failed:', e.message) } } catch (e) { console.log('getSandbox failed:', e.message) }
const list = await client.listSandboxes()
console.log('sandboxes:', list.map(s => `${s.id} ${s.status}`).join(' | '))
