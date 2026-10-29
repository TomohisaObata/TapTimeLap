// ロゴ画像を持っていないときの手続き的なプレースホルダーアイコン生成（ストップウォッチ）。
// 実ロゴがある場合は build-icon.mjs（public/icon-source.png から生成）を使うこと。
//   node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './png-io.mjs'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [0x07, 0x09, 0x0c]
const RING = [0x35, 0xd0, 0x7f]
const HAND = [0xf2, 0xf5, 0xf8]

/** d が edge を跨ぐところで 1→0 に落ちる被覆率。アンチエイリアス用。 */
function coverage(d, edge, aa) {
  return Math.min(1, Math.max(0, (edge - d) / aa + 0.5))
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

function blend(dst, color, alpha) {
  for (let i = 0; i < 3; i++) dst[i] = Math.round(dst[i] * (1 - alpha) + color[i] * alpha)
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const c = size / 2
  const aa = size / 220 // だいたい 1px 相当
  const rOuter = size * 0.36
  const rInner = size * 0.29

  // ストップウォッチの針。真上から時計回りに 40 度倒す。
  const angle = (-90 + 40) * (Math.PI / 180)
  const handLen = size * 0.235
  const handHalfWidth = size * 0.035
  const hx = c + Math.cos(angle) * handLen
  const hy = c + Math.sin(angle) * handLen

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const d = Math.hypot(px - c, py - c)

      const rgb = [...BG]

      const ringCov = coverage(d, rOuter, aa) - coverage(d, rInner, aa)
      if (ringCov > 0) blend(rgb, RING, ringCov)

      const handCov = coverage(segmentDistance(px, py, c, c, hx, hy), handHalfWidth, aa)
      if (handCov > 0) blend(rgb, HAND, handCov)

      const o = (y * size + x) * 4
      rgba[o] = rgb[0]
      rgba[o + 1] = rgb[1]
      rgba[o + 2] = rgb[2]
      rgba[o + 3] = 255 // iOS はアイコンを自前でマスクするので全面不透明で出す
    }
  }
  return rgba
}

mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]

for (const [name, size] of targets) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, size, render(size)))
  console.log(`generated public/${name} (${size}x${size})`)
}
