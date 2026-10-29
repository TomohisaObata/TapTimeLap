// 実機でしか起きない「表示が一瞬止まる」を切り分けるための計測。
// フレーム間隔が開いたときに、その前後で何が起きていたか（読み上げの開始/終了・
// ビープ・ラップ操作など）をタイムラインとして残す。走行が終わったら設定画面で確認できる。
//
// 当初は「直前1件」だけを原因候補として拾っていたが、実機での報告により
// 「読み上げが終わってから数秒後に一度だけ」という、単純な直前イベントでは
// 説明できないパターンが見つかった。単一の「原因」を当てにいくのではなく、
// 停滞の前後にあった複数のイベントをまとめて出し、判断は見た人に委ねる方針にした。

export interface StallEvent {
  label: string
  /** 停滞の開始時刻を基準にした相対時刻（ms）。負なら停滞開始より前に起きたイベント。 */
  offsetMs: number
}

export interface Stall {
  /** 走行開始からの経過（ms） */
  atMs: number
  /** フレームが飛んだ時間（ms） */
  durationMs: number
  events: StallEvent[]
}

const KEEP = 8
/** 停滞の前後この範囲に起きたイベントをまとめて記録する。 */
export const EVENT_WINDOW_MS = 4000
// ラップ間隔が数秒しかないコースでは、1回の停滞の周辺に複数ラップ分の
// イベント（タップ・ビープ・振動・発話の開始/終了）が重なって入ることがある。
// 6 だと直近のラップの発話終了イベントが押し出されて欠けることが実機で確認できたため、
// 少し余裕を持たせる。
const MAX_EVENTS_PER_STALL = 12

let events: { name: string; at: number }[] = []
let stalls: Stall[] = []
let runStart = 0

export function beginPerfRun(t0: number): void {
  runStart = t0
  events = []
  stalls = []
}

/** 重い処理の前後に呼ぶ。コマ落ちのタイムライン上に記録される。 */
export function markEvent(name: string): void {
  events.push({ name, at: performance.now() })
  if (events.length > 200) events.shift()
}

export function recordStall(now: number, durationMs: number): void {
  const stallStart = now - durationMs
  const nearby = events
    .map((e) => ({ label: e.name, offsetMs: Math.round(e.at - stallStart) }))
    .filter((e) => Math.abs(e.offsetMs) < EVENT_WINDOW_MS)
    .sort((a, b) => Math.abs(a.offsetMs) - Math.abs(b.offsetMs))
    .slice(0, MAX_EVENTS_PER_STALL)
    .sort((a, b) => a.offsetMs - b.offsetMs)

  stalls.push({
    atMs: Math.round(stallStart - runStart),
    durationMs: Math.round(durationMs),
    events: nearby,
  })
  // 長いものだけ残す
  stalls.sort((a, b) => b.durationMs - a.durationMs)
  if (stalls.length > KEEP) stalls.length = KEEP
}

export function getStalls(): Stall[] {
  return [...stalls]
}
