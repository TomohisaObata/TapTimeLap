// PNG の読み書きを外部依存なしで行う共通処理。
// gen-icons.mjs（手続き的な図形描画）と build-icon.mjs（実画像のリサイズ）の両方から使う。
import { deflateSync, inflateSync } from 'node:zlib'

/* ---------- encode ---------- */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** width×height の RGBA バッファ（1px = 4byte、アルファ込み）を PNG にエンコードする。 */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA

  // 各スキャンラインの先頭にフィルタ種別バイト(0 = None)が必要
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    const dst = y * (width * 4 + 1)
    raw[dst] = 0
    rgba.copy(raw, dst + 1, src, src + width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------- decode ---------- */

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * PNG を width/height/RGBA バッファに復元する。8bit・非インターレースのみ対応
 * （このプロジェクトで使う書き出しツール由来の PNG であれば通常この条件を満たす）。
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG signature not found')

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette = null
  const idatChunks = []

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset += 12 + len
  }

  if (interlace !== 0) throw new Error('インターレース PNG には対応していません')
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} には対応していません（8bit のみ）`)

  const channels = CHANNELS_BY_COLOR_TYPE[colorType]
  if (channels === undefined) throw new Error(`color type ${colorType} には対応していません`)
  if (colorType === 3 && !palette) throw new Error('パレット形式なのに PLTE チャンクがありません')

  const inflated = inflateSync(Buffer.concat(idatChunks))
  const stride = width * channels
  const unfiltered = Buffer.alloc(height * stride)

  // PNG のフィルタ復元（Sub/Up/Average/Paeth）。1行ずつ、直前行・直前ピクセルを参照する。
  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * (stride + 1)]
    const srcStart = y * (stride + 1) + 1
    const dstStart = y * stride
    for (let x = 0; x < stride; x++) {
      const raw = inflated[srcStart + x]
      const a = x >= channels ? unfiltered[dstStart + x - channels] : 0
      const b = y > 0 ? unfiltered[dstStart - stride + x] : 0
      const c = x >= channels && y > 0 ? unfiltered[dstStart - stride + x - channels] : 0

      let value
      switch (filterType) {
        case 0:
          value = raw
          break
        case 1:
          value = raw + a
          break
        case 2:
          value = raw + b
          break
        case 3:
          value = raw + ((a + b) >> 1)
          break
        case 4:
          value = raw + paeth(a, b, c)
          break
        default:
          throw new Error(`未知のフィルタ種別 ${filterType}`)
      }
      unfiltered[dstStart + x] = value & 0xff
    }
  }

  // 色形式によらず RGBA に揃える
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    let r, g, b
    let a = 255
    if (colorType === 2) {
      r = unfiltered[p]
      g = unfiltered[p + 1]
      b = unfiltered[p + 2]
    } else if (colorType === 6) {
      r = unfiltered[p]
      g = unfiltered[p + 1]
      b = unfiltered[p + 2]
      a = unfiltered[p + 3]
    } else if (colorType === 0) {
      r = g = b = unfiltered[p]
    } else if (colorType === 4) {
      r = g = b = unfiltered[p]
      a = unfiltered[p + 1]
    } else {
      const idx = unfiltered[p]
      r = palette[idx * 3]
      g = palette[idx * 3 + 1]
      b = palette[idx * 3 + 2]
    }
    const o = i * 4
    rgba[o] = r
    rgba[o + 1] = g
    rgba[o + 2] = b
    rgba[o + 3] = a
  }

  return { width, height, rgba }
}

/**
 * 面積平均（ボックスフィルタ）によるリサイズ。単純な間引きと違い、細い線や
 * 文字のエッジが縮小時にジャギらずに馴染む。大幅な縮小（ロゴのアイコン化）向け。
 */
export function resizeBox(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4)

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor((dy * srcH) / dstH)
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * srcH) / dstH))
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor((dx * srcW) / dstW)
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * srcW) / dstW))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * srcW + sx) * 4
          r += src[o]
          g += src[o + 1]
          b += src[o + 2]
          a += src[o + 3]
          n++
        }
      }

      const o = (dy * dstW + dx) * 4
      dst[o] = Math.round(r / n)
      dst[o + 1] = Math.round(g / n)
      dst[o + 2] = Math.round(b / n)
      dst[o + 3] = Math.round(a / n)
    }
  }

  return dst
}

/**
 * 中央を通る十字方向に外側から走査し、背景色（白系）とロゴ本体の境界を探す。
 * アプリアイコンのロゴ画像に周囲の余白が入っている場合、その余白を検出するために使う。
 * iOS はアイコン画像の外周をそのまま自分の角丸マスクで切り抜くため、余白入りの画像を
 * そのまま使うと角丸の外側に白い縁が残って見える。
 */
export function detectContentSquare(rgba, width, height, threshold = 245) {
  const isBackground = (x, y) => {
    const o = (y * width + x) * 4
    return rgba[o] >= threshold && rgba[o + 1] >= threshold && rgba[o + 2] >= threshold
  }

  const cy = Math.floor(height / 2)
  const cx = Math.floor(width / 2)

  let left = 0
  while (left < cx && isBackground(left, cy)) left++
  let right = width - 1
  while (right > cx && isBackground(right, cy)) right--
  let top = 0
  while (top < cy && isBackground(cx, top)) top++
  let bottom = height - 1
  while (bottom > cy && isBackground(cx, bottom)) bottom--

  // 4方向の中で最も狭い余白に合わせる。多少の左右非対称があっても、
  // 本体を誤って切り落とすよりは薄く余白が残るほうが安全。
  const margin = Math.min(left, width - 1 - right, top, height - 1 - bottom)
  const size = Math.min(width, height) - margin * 2
  return { x: margin, y: margin, size }
}

/** RGBA バッファから矩形部分を切り出す。 */
export function cropRgba(rgba, srcWidth, x, y, w, h) {
  const dst = Buffer.alloc(w * h * 4)
  for (let row = 0; row < h; row++) {
    const srcOffset = ((y + row) * srcWidth + x) * 4
    const dstOffset = row * w * 4
    rgba.copy(dst, dstOffset, srcOffset, srcOffset + w * 4)
  }
  return dst
}
