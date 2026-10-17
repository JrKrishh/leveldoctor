// Local server for the on-camera take: serves demo/ and saves recordings POSTed to /upload into demo/work/.
// usage: node demo/serve.mjs  → open http://localhost:8099/recorder.html (camera access needs localhost)
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url)), PORT = +process.env.PORT || 8099
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css' }
createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url.startsWith('/upload')) {
      const chunks = []; for await (const c of req) chunks.push(c)
      await mkdir(path.join(DIR, 'work'), { recursive: true })
      const name = `take-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.webm`
      await writeFile(path.join(DIR, 'work', name), Buffer.concat(chunks))
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ saved: `demo/work/${name}` }))
    }
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'recorder.html'
    const file = path.resolve(DIR, rel)
    if (!file.startsWith(DIR)) { res.writeHead(403); return res.end() }
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(data)
  } catch { res.writeHead(404); res.end('not found') }
}).listen(PORT, () => console.log(`recorder → http://localhost:${PORT}/recorder.html`))
