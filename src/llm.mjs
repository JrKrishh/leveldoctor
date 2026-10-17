// LLM access, first provider with a key wins: OpenRouter (provisioned by `stripe projects add openrouter/api`),
// Nebius Token Factory, then a local Ollama model. Keys come from the environment or .env / .env.local (never logged).
import './env.mjs'

const PROVIDERS = {
  openrouter: { key: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3-coder:free' },
  nebius: { key: 'NEBIUS_API_KEY', url: process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507' },
}
const provider = () => process.env.LD_PROVIDER || Object.keys(PROVIDERS).find(k => process.env[PROVIDERS[k].key]) || 'ollama'
const model = () => process.env.LD_MODEL || (PROVIDERS[provider()]?.model ?? (process.env.LD_OLLAMA_MODEL || 'qwen3:4b'))
export const llmName = () => `${provider()}:${model()}`

export async function chat(messages, { maxTokens = 3000 } = {}) {
  const t0 = Date.now(), p = PROVIDERS[provider()]
  let text
  if (p) {   // OpenAI-compatible chat completions
    const res = await fetch(`${p.url}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env[p.key]}`, 'Content-Type': 'application/json', 'X-Title': 'Level Doctor' },
      body: JSON.stringify({ model: model(), messages, max_tokens: Math.max(maxTokens, 8000), temperature: 0.4 }),
    })
    if (!res.ok) throw new Error(`${provider()} ${res.status}: ${(await res.text()).slice(0, 300)}`)
    text = (await res.json()).choices?.[0]?.message?.content || ''
  } else {
    const res = await fetch('http://localhost:11434/api/chat', {   // streamed: a slow local model must not hit fetch's header timeout
      method: 'POST',
      body: JSON.stringify({ model: model(), stream: true, think: false,   // qwen3 ignores think:false on this Ollama; /no_think does work
        messages: messages.map((m, i) => i === messages.length - 1 && m.role === 'user' ? { ...m, content: m.content + ' /no_think' } : m),
        options: { num_predict: Math.max(maxTokens, 4500), num_ctx: 6144, temperature: 0.4 } }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`)
    text = ''
    let buf = ''
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) text += JSON.parse(line).message?.content || '' }
    }
  }
  return { text: text.replace(/<think>[\s\S]*?<\/think>/g, ''), ms: Date.now() - t0, model: llmName() }
}

/** Models the current provider offers (to check a model name before a long run). */
export async function listModels() {
  const p = PROVIDERS[provider()]
  if (!p) return []
  const res = await fetch(`${p.url}/models`, { headers: { Authorization: `Bearer ${process.env[p.key]}` } })
  if (!res.ok) throw new Error(`${provider()} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).data.map(m => m.id)
}

/** The last fenced code block in a reply (models often think out loud before the answer). */
export function codeBlock(text) {
  const blocks = [...text.matchAll(/```(?:javascript|js|mjs)?\s*\n([\s\S]*?)```/g)].map(m => m[1])
  return blocks.length ? blocks[blocks.length - 1] : null
}
