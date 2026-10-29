// 表示は小数第2位まで。分と秒に割る前に 10ms 単位へ丸めておかないと、
// 59.999 秒が「0分 60.00 秒」になって桁が繰り上がらない。
function splitTime(ms: number): { minutes: number; seconds: number } {
  const rounded = Math.round(Math.max(0, ms) / 10) * 10
  return { minutes: Math.floor(rounded / 60000), seconds: (rounded % 60000) / 1000 }
}

/** ミリ秒を "1:23.45" 形式に整形する。1分未満なら "23.45"。 */
export function formatLap(ms: number): string {
  const { minutes, seconds } = splitTime(ms)
  if (minutes === 0) return seconds.toFixed(2)
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
}

/** 音声読み上げ用。"23.45" / "1分23.45秒" のように日本語で返す。 */
export function speakableLap(ms: number): string {
  const { minutes, seconds } = splitTime(ms)
  if (minutes === 0) return seconds.toFixed(2)
  return `${minutes}分${seconds.toFixed(2)}秒`
}

/** 直前ラップとベストの差分を "-0.32" / "+1.05" で返す。差が無い場合は null。 */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '-' : '+'
  return `${sign}${(Math.abs(ms) / 1000).toFixed(2)}`
}

/**
 * 各ラップ通過時点での残り時間（ms）を計算する。制限時間なしのセッションでは
 * 全要素 null。ラップの累計経過時間から逆算するだけなので、走行中も
 * 保存済みセッションの再表示でも同じ計算で済む。
 */
export function remainingAtLaps(laps: number[], timeLimitSec: number | undefined): (number | null)[] {
  if (timeLimitSec === undefined) return laps.map(() => null)
  const limitMs = timeLimitSec * 1000
  let cumulative = 0
  return laps.map((ms) => {
    cumulative += ms
    return Math.max(0, limitMs - cumulative)
  })
}

export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
