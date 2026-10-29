// assets/icon-source.png（ロゴ原稿）から、PWA / ホーム画面用の各サイズを書き出す。
// 追加の画像ライブラリは使わず png-io.mjs のデコード/リサイズ/エンコードのみで完結する。
//
// 原稿は public/ ではなく assets/ に置くこと。Vite は public/ の中身を丸ごとビルド
// 成果物にコピー（＝ Service Worker のプリキャッシュ対象）するため、public/ に置くと
// 使われないはずの高解像度原稿（1MB 近い）までオフラインキャッシュに含まれてしまう。
//   node scripts/build-icon.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cropRgba, decodePng, detectContentSquare, encodePng, resizeBox } from './png-io.mjs'

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT_DIR, 'public')
const SOURCE_PATH = join(ROOT_DIR, 'assets', 'icon-source.png')

if (!existsSync(SOURCE_PATH)) {
  console.error(
    `assets/icon-source.png が見つかりません。\n` +
      `ロゴ画像をこのファイル名で assets/ に置いてから再実行してください。`,
  )
  process.exit(1)
}

const src = decodePng(readFileSync(SOURCE_PATH))
console.log(`元画像: ${src.width}x${src.height}`)

if (src.width !== src.height) {
  console.warn(
    `警告: 元画像が正方形ではありません。左上基準でそのまま縮小するため、` +
      `意図しないトリミングになる可能性があります。`,
  )
}

// iOS はアイコン画像の外周をそのまま自分の角丸マスクで切り抜く。元画像にロゴ周囲の
// 白い余白が残っていると、ホーム画面でその余白が白い縁として見えてしまう
// （実機で確認済み）。中央の十字方向を走査して余白を検出し、ロゴ本体だけを
// 画面いっぱいまで拡大する。
const { x, y, size: cropSize } = detectContentSquare(src.rgba, src.width, src.height)
const marginPct = ((x / src.width) * 100).toFixed(1)
console.log(`検出した余白: ${x}px（${marginPct}%）→ ${cropSize}x${cropSize} に切り抜いて拡大`)

const cropped =
  x === 0 && y === 0 && cropSize === src.width
    ? src.rgba
    : cropRgba(src.rgba, src.width, x, y, cropSize, cropSize)

const targets = [
  ['icon-512.png', 512],
  ['icon-192.png', 192],
  ['apple-touch-icon.png', 180],
]

for (const [name, size] of targets) {
  const resized = resizeBox(cropped, cropSize, cropSize, size, size)
  writeFileSync(join(PUBLIC_DIR, name), encodePng(size, size, resized))
  console.log(`generated public/${name} (${size}x${size})`)
}
