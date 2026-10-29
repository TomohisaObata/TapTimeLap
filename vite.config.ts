import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// http://localhost はブラウザ的に secure context 扱いなので Wake Lock も動く。
// 一方 LAN の IP（http://192.168.x.x）は secure context ではないため、
// iPhone 実機で確認するときだけ自己署名証明書で https を張る。
const lanMode = process.argv.includes('--host')

// iOS Safari は apple-touch-icon を URL 単位でかなり長く（アプリをホーム画面から
// 削除しても）キャッシュする。ファイル名は変えずに済ませたいので、アイコンの中身の
// ハッシュをクエリ文字列として付け、中身が変わったときだけ URL も変わるようにする。
// これにより「アイコンを差し替えたのに反映されない」を再デプロイのたびに防げる。
const iconPath = resolve(__dirname, 'public/apple-touch-icon.png')
const iconVersion = existsSync(iconPath)
  ? createHash('sha1').update(readFileSync(iconPath)).digest('hex').slice(0, 8)
  : 'dev'

function iconVersionPlugin(): Plugin {
  return {
    name: 'icon-version',
    transformIndexHtml(html) {
      return html.replace(/__ICON_VERSION__/g, iconVersion)
    },
  }
}

// base は GitHub Pages 等のサブパス配信に備えて環境変数で差し替えられるようにしておく。
// 例: BASE=/TapTimeLap/ npm run build
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [
    react(),
    iconVersionPlugin(),
    ...(lanMode ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'TapTimeLap',
        short_name: 'TapTimeLap',
        description: 'FPVドローンレース用タップ式ラップタイマー',
        lang: 'ja',
        start_url: '.',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#07090c',
        theme_color: '#07090c',
        icons: [
          { src: `icon-192.png?v=${iconVersion}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `icon-512.png?v=${iconVersion}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: `icon-512.png?v=${iconVersion}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 計測中に電波が切れても動き続けるよう、ビルド成果物は全てプリキャッシュする。
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
  },
})
