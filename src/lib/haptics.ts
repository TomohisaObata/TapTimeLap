// iOS Safari は標準の Vibration API（navigator.vibrate）を実装していない。
// 代わりに Safari 17.4 で入った <input type="checkbox" switch> の副作用を使う。
// この要素を label 経由でクリックすると Taptic Engine が鳴る。
// input を直接 click() しても鳴らず、label を経由する必要がある点に注意。
//
// この裏技は iOS 17.4〜26.4 で動作するが、iOS 26.5 で塞がれたとされる。
// 動かない環境では単に無反応になるだけなので、失敗しても計測には影響しない。

import { markEvent } from './perf'

let label: HTMLLabelElement | null = null

function ensureSwitch(): HTMLLabelElement {
  if (label) return label

  const el = document.createElement('label')
  el.setAttribute('aria-hidden', 'true')
  // display:none にすると要素が描画されず haptic が鳴らないため、
  // 画面外に飛ばして見えなくする
  el.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none'

  const input = document.createElement('input')
  input.type = 'checkbox'
  // JSX では非標準属性のため、DOM API で直接付ける
  input.setAttribute('switch', '')
  el.appendChild(input)

  document.body.appendChild(el)
  label = el
  return el
}

/** 短い振動を1回。対応していない環境では何も起きない。 */
export function haptic(): void {
  markEvent('haptic')
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(15)
    return
  }
  try {
    ensureSwitch().click()
  } catch {
    /* 非対応環境。無音で無視する */
  }
}

/** 標準 API が使えるか。iOS では常に false になる。 */
export function hasVibrationApi(): boolean {
  return typeof navigator.vibrate === 'function'
}

/** iOS のバージョン。iPhone/iPad 以外や判定できない場合は null。 */
export function iosVersion(): { major: number; minor: number } | null {
  const m = /(?:iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/.exec(navigator.userAgent)
  const major = Number(m?.[1])
  const minor = Number(m?.[2])
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
  return { major, minor }
}

/**
 * スイッチ要素経由の haptic を OS 側が塞いでいるか。
 * iOS 17.4〜26.4 では動作し、26.5 で Apple が塞いだ。
 */
export function hapticBlockedByOs(): boolean {
  const v = iosVersion()
  if (!v) return false
  return v.major > 26 || (v.major === 26 && v.minor >= 5)
}
