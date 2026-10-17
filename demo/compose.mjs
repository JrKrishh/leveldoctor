// Final video: the demo's picture + the presenter's webcam in a round bubble + the presenter's voice, game music under it.
// A take shorter than the video (e.g. only an on-camera intro) keeps the TTS narration for the rest.
// usage: node demo/compose.mjs demo/work/take-XXXX.webm   → demo/leveldoctor-final.mp4
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const take = process.argv[2]
if (!take || !existsSync(take)) throw new Error('usage: node demo/compose.mjs <take.webm>')
const NORMAL = 'demo/leveldoctor-demo.mp4', PRESENTER = 'demo/leveldoctor-demo-presenter.mp4', OUT = 'demo/leveldoctor-final.mp4'
const music = path.resolve('../mashpit/public/audio/music.mp3')
const dur = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()
// MediaRecorder webm files have no duration header, so use the last packet timestamp
const lastPts = s => Math.max(0, ...execFileSync('ffprobe', ['-v', 'error', '-select_streams', s, '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', take]).toString().split(/\s+/).map(Number).filter(Number.isFinite))
const takeDur = Math.max(lastPts('v:0'), lastPts('a:0'))
const full = takeDur >= dur(NORMAL) * 0.8
// Full take: the presenter-layout video keeps a column free on the right, so the bubble covers nothing.
// Intro-only take: the normal video, bubble bottom-left over the title scene's empty corner.
const VIDEO = full && existsSync(PRESENTER) ? PRESENTER : NORMAL, vidDur = dur(VIDEO)
const S = 230, R = S / 2, POS = VIDEO === PRESENTER ? `W-w-13:${Math.round((636 - S) / 2)}` : `40:${720 - 84 - S - 30}`
console.log(`video ${vidDur.toFixed(1)} s (${path.basename(VIDEO)}), take ${takeDur.toFixed(1)} s → ${full ? 'presenter voice throughout' : 'presenter intro, then TTS'}`)

const cam = `[1:v]crop='min(iw,ih)':'min(iw,ih)',scale=${S}:${S},format=yuva420p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(gt((X-${R})*(X-${R})+(Y-${R})*(Y-${R}),${R}*${R}),0,255)'[cam]`
const showCam = full ? '' : `:enable='lte(t,${takeDur.toFixed(2)})'`
const filters = [cam, `[0:v][cam]overlay=${POS}${showCam}[v]`, `[1:a]highpass=f=80,loudnorm=I=-16:TP=-1.5[voice]`]
let mix
if (full) { filters.push(`[2:a]volume=0.06,atrim=0:${vidDur.toFixed(2)}[m]`); mix = '[voice][m]' }
else { filters.push(`[0:a]volume='if(lte(t,${takeDur.toFixed(2)}),0,1)':eval=frame[tts]`); mix = '[voice][tts]' }
filters.push(`${mix}amix=inputs=2:normalize=0:duration=longest[a]`)
const inputs = ['-i', VIDEO, '-i', take, ...(full && existsSync(music) ? ['-stream_loop', '-1', '-i', music] : [])]
if (full && !existsSync(music)) filters.splice(filters.length - 2, 2, `[voice]anull[a]`)
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-t', vidDur.toFixed(2), OUT], { stdio: 'pipe' })
console.log(`final → ${OUT}`)
