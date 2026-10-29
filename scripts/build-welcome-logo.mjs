// assets/welcome-logo-source.png（起動画面用ロゴ原稿）から、画面表示用に軽量化した
// バージョンを書き出す。アイコンと違って OS の角丸マスクを気にする必要はない
// （アプリ内にそのまま表示するだけ）ので、余白検出は行わずリサイズのみ。
//
// 原稿は public/ ではなく assets/ に置くこと。理由は build-icon.mjs と同じ ――
// public/ の中身は Service Worker が丸ごとオフラインキャッシュするため、
// 画面には小さくしか出さない高解像度の原稿をそのまま置くと無駄に大きくなる。
//   node scripts/build-welcome-logo.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, resizeBox } from './png-io.mjs'

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATH = join(ROOT_DIR, 'assets', 'welcome-logo-source.png')
const OUT_PATH = join(ROOT_DIR, 'public', 'welcome-logo.png')
// 画面上では 200px 前後で表示する想定。retina 端末でも十分な余裕を見た値。
const SIZE = 480

if (!existsSync(SOURCE_PATH)) {
  console.error(
    `assets/welcome-logo-source.png が見つかりません。\n` +
      `ロゴ画像をこのファイル名で assets/ に置いてから再実行してください。`,
  )
  process.exit(1)
}

const src = decodePng(readFileSync(SOURCE_PATH))
const resized = resizeBox(src.rgba, src.width, src.height, SIZE, SIZE)
writeFileSync(OUT_PATH, encodePng(SIZE, SIZE, resized))
console.log(`generated public/welcome-logo.png (${SIZE}x${SIZE}, 元: ${src.width}x${src.height})`)
