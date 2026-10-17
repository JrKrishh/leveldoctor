// LLM access. OpenRouter when the key from `stripe projects env --pull` is present; otherwise a local Ollama model.
const OR_KEY = () => process.env.OPENROUTER_API_KEY
export const llmName = () => OR_KEY() ? `openrouter:${process.env.LD_MODEL || 'qwen/qwen3-coder:free'}` : `ollama:${process.env.LD_OLLAMA_MODEL || 'qwen3:4b'}`

export async function chat(messages, { maxTokens = 3000 } = {}) {
  const t0 = Date.now()
  let text
  if (OR_KEY()) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OR_KEY()}`, 'Content-Type': 'application/json', 'X-Title': 'Level Doctor' },
      body: JSON.stringify({ model: process.env.LD_MODEL || 'qwen/qwen3-coder:free', messages, max_tokens: maxTokens, temperature: 0.4 }),
    })
    if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
    text = (await res.json()).choices?.[0]?.message?.content || ''
  } else {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: process.env.LD_OLLAMA_MODEL || 'qwen3:4b', stream: false, think: false, messages,
        options: { num_predict: maxTokens, num_ctx: 8192, temperature: 0.4 } }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`)
    text = (await res.json()).message?.content || ''
  }
  return { text: text.replace(/<think>[\s\S]*?<\/think>/g, ''), ms: Date.now() - t0, model: llmName() }
}

/** The last fenced code block in a reply (models often think out loud before the answer). */
export function codeBlock(text) {
  const blocks = [...text.matchAll(/```(?:javascript|js|mjs)?\s*\n([\s\S]*?)```/g)].map(m => m[1])
  return blocks.length ? blocks[blocks.length - 1] : null
}
