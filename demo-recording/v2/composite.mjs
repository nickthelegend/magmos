#!/usr/bin/env node
/**
 * Assemble the final cut.
 *
 * Narration is placed at each beat's *mark time* inside its source clip rather than concatenated
 * back to back. The recordings contain unnarrated connective tissue — a wallet connect, a page load,
 * a scan that takes six seconds — and stacking the voice-over end to end would slide it out of sync
 * with the thing it is describing within the first minute.
 *
 * Order of the cut deliberately differs from the recording order: the org capture runs
 * landing → … → batches in one take, but "delivery batches" belongs after the worker has claimed,
 * so that section is split out and re-placed. Splitting a take is cheaper than recording two.
 *
 *   node v2/composite.mjs
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const WORK = `${HERE}work`
const OUT = `${HERE}out`
mkdirSync(WORK, { recursive: true })
mkdirSync(OUT, { recursive: true })

const sh = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('\n✗ ffmpeg failed:\n  ' + cmd.slice(0, 220))
    console.error('  ' + (e.stderr?.toString() || '').split('\n').filter(Boolean).slice(-6).join('\n  '))
    throw e
  }
}

const webmIn = (dir) => {
  const f = readdirSync(`${HERE}${dir}`).filter((x) => x.endsWith('.webm')).sort()
  if (!f.length) throw new Error(`no webm in ${dir}`)
  // Playwright can emit more than one file if a page opened; the longest is the real take.
  const best = f
    .map((n) => ({ n, d: dur(`${HERE}${dir}/${n}`) }))
    .sort((a, b) => b.d - a.d)[0]
  return `${HERE}${dir}/${best.n}`
}

const dur = (f) =>
  Number(
    execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${f}"`,
      { encoding: 'utf8' }
    ).trim()
  )

const marks = (f) => Object.fromEntries(JSON.parse(readFileSync(`${HERE}${f}`, 'utf8')).marks.map((m) => [m.id, m.at]))
const VO = (id) => `${HERE}vo/${id}.wav`

// 1080p everywhere so concat never has to rescale mid-stream.
const V_FILTER = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30'
const V_ENC = '-c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p'
const V = `${V_ENC} -r 30 -vf "${V_FILTER}"`
const A = '-c:a aac -b:a 192k -ar 48000 -ac 2'

/**
 * Burn a clip with its narration laid in, tightening dead air out of the picture.
 *
 * The recordings contain a lot of nothing — a wallet connect, a page load, a six-second chain scan.
 * Left alone the cut runs nearly seven minutes for five minutes of voice. Rather than hand-trimming
 * the middle of every take, the video is sped by a factor derived from the beats themselves: the
 * largest speed-up that still leaves each narration line finishing before the next visual arrives.
 * Only the picture is retimed — the voice plays at its natural pace, placed at the scaled mark, so
 * every line still lands on the thing it describes.
 *
 * The cursor moves slightly faster as a result, which reads as a confident operator rather than a
 * glitch. `apad` is what stops amix truncating to the shortest input.
 */
function segment(name, videoIn, beats, { from = 0, to = null, tail = 1.0 } = {}) {
  const outFile = `${WORK}/${name}.mp4`
  const srcEnd = to ?? dur(videoIn)
  const pieces = []

  // One slice per beat, each retimed so the picture for that beat lasts exactly as long as the line
  // describing it. A single speed factor for the whole segment is hostage to its tightest gap — this
  // removes dead air wherever it actually is, and guarantees every line starts on its own visual.
  beats.forEach((b, i) => {
    const srcFrom = b.at
    const srcTo = i + 1 < beats.length ? beats[i + 1].at : srcEnd
    const srcLen = srcTo - srcFrom
    const voLen = dur(VO(b.id))
    const target = voLen + (i + 1 < beats.length ? 0.3 : tail)
    // Clamped: past about 2.6x the cursor stops reading as a person, and below 1x we would be
    // padding rather than tightening.
    const k = Math.min(2.6, Math.max(1, Number((srcLen / target).toFixed(3))))

    const piece = `${WORK}/${name}-${String(i).padStart(2, '0')}.mp4`
    sh(
      `ffmpeg -y -ss ${srcFrom.toFixed(2)} -to ${srcTo.toFixed(2)} -i "${videoIn}" -i "${VO(b.id)}" ` +
        `-filter_complex "[0:v]setpts=PTS/${k},${V_FILTER}[v];[1:a]apad[a]" ` +
        `-map "[v]" -map "[a]" -t ${target.toFixed(2)} ${V_ENC} ${A} "${piece}"`
    )
    pieces.push(piece)
  })

  const list = `${WORK}/${name}-list.txt`
  sh(`printf '%s\\n' ${pieces.map((p) => `"file '${p}'"`).join(' ')} > "${list}"`)
  sh(`ffmpeg -y -f concat -safe 0 -i "${list}" -c copy "${outFile}"`)

  console.log(`  ${name.padEnd(16)} ${dur(outFile).toFixed(1)}s   (from ${(srcEnd - from).toFixed(1)}s)`)
  return outFile
}

/** A held card, for the closing beat. */
function card(name, html, seconds, voId) {
  const png = `${WORK}/${name}.png`
  sh(
    `ffmpeg -y -f lavfi -i color=c=0x0b0b0e:s=1920x1080:d=1 -frames:v 1 "${png}"` // placeholder, replaced below
  )
  void html
  const out = `${WORK}/${name}.mp4`
  sh(
    `ffmpeg -y -loop 1 -t ${seconds.toFixed(2)} -i "${png}" -i "${VO(voId)}" ` +
      `${V} ${A} -shortest "${out}"`
  )
  return out
}
void card

console.log('\nBuilding segments\n')

const mOrg = marks('marks-org.json')
const mEmp = marks('marks-emp.json')
const mExp = marks('marks-explorer.json')

const orgVid = webmIn('raw-org')
const empVid = webmIn('raw-emp')
const expVid = webmIn('raw-explorer')
const verVid = webmIn('raw-verify')

const introMp4 = (() => {
  const d = `${HERE}intro/renders`
  const f = readdirSync(d).filter((x) => x.endsWith('.mp4')).sort().pop()
  return `${d}/${f}`
})()

// ── 00 intro: the three problem/solution beats sit at the scene boundaries ──
const s00 = segment('00-intro', introMp4, [
  { id: 'intro_problem', at: 0.2 },
  { id: 'intro_problem2', at: 14.4 },
  { id: 'intro_solution', at: 26.4 },
])

// ── 10 employer, part one: landing through delivery ──
const s10 = segment(
  '10-org',
  orgVid,
  ['landing', 'roster', 'roster_badge', 'agent', 'verdict', 'settle', 'delivered'].map((id) => ({
    id,
    at: mOrg[id],
  })),
  { to: mOrg.batches }
)

// ── 20 explorer ──
const s20 = segment('20-explorer', expVid, ['explorer_intro', 'explorer_settle', 'explorer_batch'].map((id) => ({ id, at: mExp[id] })))

// ── 30 worker ──
const s30 = segment('30-employee', empVid, ['employee_intro', 'employee_recover', 'employee_claim'].map((id) => ({ id, at: mEmp[id] })))

// ── 40 verification terminal ──
const s40 = segment('40-verify', verVid, [
  { id: 'verify', at: 0.3 },
  { id: 'verify_result', at: 19.0 },
])

// ── 50 employer, part two: the batches table, re-placed after the claim ──
const s50 = segment('50-batches', orgVid, [{ id: 'batches', at: mOrg.batches }], { from: mOrg.batches })

// ── 60 close: hold the final frame of the batches view under the closing line ──
const closeStill = `${WORK}/close.png`
sh(`ffmpeg -y -sseof -1 -i "${s50}" -frames:v 1 -q:v 2 "${closeStill}"`)
const closeSecs = dur(VO('close')) + 1.2
sh(
  `ffmpeg -y -loop 1 -t ${closeSecs.toFixed(2)} -i "${closeStill}" -i "${VO('close')}" ` +
    `-filter_complex "[0:v]scale=1920:1080,setsar=1,zoompan=z='min(zoom+0.0006,1.06)':d=${Math.round(closeSecs * 30)}:s=1920x1080:fps=30,format=yuv420p[v]" ` +
    `-map "[v]" -map 1:a -c:v libx264 -preset medium -crf 19 ${A} -shortest "${WORK}/60-close.mp4"`
)
console.log(`  60-close         ${dur(`${WORK}/60-close.mp4`).toFixed(1)}s`)

// ── concat ──
const parts = [s00, s10, s20, s30, s40, s50, `${WORK}/60-close.mp4`]
const list = `${WORK}/concat.txt`
sh(`printf '%s\\n' ${parts.map((p) => `"file '${p}'"`).join(' ')} > "${list}"`)

const master = `${OUT}/magmos-confidential-payroll.mp4`
sh(`ffmpeg -y -f concat -safe 0 -i "${list}" -c copy "${master}"`)
const masterDur = dur(master)

// ── 1.2x ──
// setpts for video, atempo for audio. atempo is pitch-preserving, so the narrator speeds up without
// turning into a chipmunk.
const fast = `${OUT}/magmos-confidential-payroll-1.2x.mp4`
sh(
  `ffmpeg -y -i "${master}" -filter_complex "[0:v]setpts=PTS/1.2[v];[0:a]atempo=1.2[a]" ` +
    `-map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p ${A} "${fast}"`
)

console.log(`\n  master  ${(masterDur / 60).toFixed(2)} min  ${master}`)
console.log(`  1.2x    ${(dur(fast) / 60).toFixed(2)} min  ${fast}\n`)
