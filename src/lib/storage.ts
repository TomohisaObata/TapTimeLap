import { remainingAtLaps } from './format'

export interface Session {
  id: string
  /** セッション開始時刻（epoch ms） */
  startedAt: number
  courseName: string
  /** 各ラップの所要時間（ms）。1本目は「スタート → 1周目通過」。 */
  laps: number[]
  /** この走行時に有効だった制限時間（秒）。制限時間なしなら undefined。 */
  timeLimitSec?: number
}

export interface Settings {
  /** 誤タップ除け。この時間内の2回目のタップは無視する（ms）。 */
  minLapMs: number
  voiceEnabled: boolean
  /** 読み上げに「ラップ3」のような周回数を含めるか。 */
  announceLapNumber: boolean
  /** 読み上げに「残り時間◯◯」を含めるか。制限時間を使っているときのみ意味を持つ。 */
  announceRemaining: boolean
  beepEnabled: boolean
  /** タップ時の振動。対応していない端末では効果がない。 */
  hapticEnabled: boolean
  countdownEnabled: boolean
  courseName: string
  /** 1本の走行の制限時間。スタートからの累計で判定する。 */
  timeLimitEnabled: boolean
  timeLimitSec: number
  /** 制限時間の何秒前から秒読みを始めるか。0 なら秒読みなし。 */
  finalCountdownSec: number
}

export const DEFAULT_SETTINGS: Settings = {
  minLapMs: 3000,
  voiceEnabled: true,
  announceLapNumber: false,
  announceRemaining: false,
  beepEnabled: true,
  hapticEnabled: true,
  countdownEnabled: false,
  courseName: '',
  timeLimitEnabled: false,
  timeLimitSec: 90,
  finalCountdownSec: 5,
}

const SESSIONS_KEY = 'taptimelap.sessions.v1'
const SETTINGS_KEY = 'taptimelap.settings.v1'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    // プライベートブラウズ等で localStorage が使えない場合も計測自体は続行させる
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 保存に失敗しても計測は止めない */
  }
}

export function loadSessions(): Session[] {
  return readJson<Session[]>(SESSIONS_KEY, [])
}

export function saveSession(session: Session): Session[] {
  const next = [session, ...loadSessions()].slice(0, 200)
  writeJson(SESSIONS_KEY, next)
  return next
}

export function deleteSession(id: string): Session[] {
  const next = loadSessions().filter((s) => s.id !== id)
  writeJson(SESSIONS_KEY, next)
  return next
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(SETTINGS_KEY, {}) }
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings)
}

export function sessionsToCsv(sessions: Session[]): string {
  const rows = [
    ['session_id', 'date', 'course', 'lap_no', 'lap_ms', 'lap_sec', 'remain_sec'],
  ]
  for (const s of sessions) {
    const remain = remainingAtLaps(s.laps, s.timeLimitSec)
    s.laps.forEach((ms, i) => {
      rows.push([
        s.id,
        new Date(s.startedAt).toISOString(),
        s.courseName,
        String(i + 1),
        String(ms),
        (ms / 1000).toFixed(3),
        remain[i] === null ? '' : (remain[i]! / 1000).toFixed(3),
      ])
    })
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

export function downloadCsv(csv: string, filename: string): void {
  // Excel が UTF-8 と判定できるよう BOM を先頭に付ける
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
