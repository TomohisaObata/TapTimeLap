import { useCallback, useEffect, useRef, useState } from 'react'
import { markEvent } from '../lib/perf'

/**
 * 計測中に画面が消えないようにする（iOS Safari 16.4+ / secure context 必須）。
 * バックグラウンド復帰時に OS 側で解放されるため、visibilitychange で取り直す。
 */
export function useWakeLock(active: boolean) {
  const sentinel = useRef<WakeLockSentinel | null>(null)
  const [supported] = useState(() => 'wakeLock' in navigator)

  const request = useCallback(async () => {
    if (!supported || sentinel.current) return
    try {
      markEvent('wakelock-request')
      sentinel.current = await navigator.wakeLock.request('screen')
      sentinel.current.addEventListener('release', () => {
        markEvent('wakelock-release')
        sentinel.current = null
      })
    } catch {
      // 低電力モードなど、取得できない状況は珍しくないので握りつぶす
    }
  }, [supported])

  const release = useCallback(async () => {
    try {
      await sentinel.current?.release()
    } catch {
      /* 解放済み */
    }
    sentinel.current = null
  }, [])

  useEffect(() => {
    if (active) void request()
    else void release()
    return () => {
      void release()
    }
  }, [active, request, release])

  useEffect(() => {
    const onVisible = () => {
      markEvent(`visibilitychange:${document.visibilityState}`)
      if (active && document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [active, request])

  return { supported }
}
