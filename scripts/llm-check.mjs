// Checks the LLM provider: which one is active, that the model exists, and a one-line reply. Never prints keys.
import { chat, llmName, listModels } from '../src/llm.mjs'
console.log('provider:', llmName())
try { const ids = await listModels(); if (ids.length) { const want = llmName().split(':').slice(1).join(':'); console.log(ids.includes(want) ? `model ${want} available` : `model ${want} NOT listed; coder-ish options: ${ids.filter(i => /coder|deepseek|qwen3|llama-3.3|kimi|glm/i.test(i)).slice(0, 12).join(', ')}`) } } catch (e) { console.log('model list failed:', e.message) }
const { text, ms } = await chat([{ role: 'user', content: 'Reply with exactly: ready' }], { maxTokens: 20 })
console.log(`reply in ${ms} ms: ${text.trim().slice(0, 60)}`)
