import { useCallback, useEffect, useRef, useState } from 'react'
import { HistoryPanel } from './components/HistoryPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { SessionCard } from './components/SessionCard'
import { useWakeLock } from './hooks/useWakeLock'
import { announceLap, beep, cancelSpeech, speak, speakWhenReady, unlockAudio } from './lib/audio'
import { haptic } from './lib/haptics'
import { formatDelta, formatLap, remainingAtLaps } from './lib/format'
import { beginPerfRun, markEvent, recordStall } from './lib/perf'
import {
  loadSessions,
  loadSettings,
  saveSession,
  saveSettings,
  type Session,
  type Settings,
} from './lib/storage'

type Phase = 'welcome' | 'idle' | 'countdown' | 'running' | 'result'
type Overlay = 'none' | 'history' | 'settings'

// 表示更新のフレーム間隔がこれより開いたら「詰まり」として記録する。
// 通常のフレームは 16ms 前後なので、80ms は体感で気付くレベルの余裕を見た値。
const STALL_THRESHOLD_MS = 80

function newId(): string {
  return crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('welcome')
  const [laps, setLaps] = useState<number[]>([])
  const [countdown, setCountdown] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [lastSession, setLastSession] = useState<Session | null>(null)
  const [rejected, setRejected] = useState(false)
  // welcome 画面をタップした瞬間から true。CSS でゆっくりフェードアウトさせつつ、
  // 実際に phase を 'idle' に切り替えるのは読み上げが終わってから（下の onClick 参照）。
  const [welcomeExiting, setWelcomeExiting] = useState(false)
  const welcomeExitingRef = useRef(false)

  // 表示更新は rAF から DOM に直接書き込む。React の再描画を毎フレーム走らせない。
  // warning/timeUp も同じ理由で state ではなく ref + 直接 DOM 操作にしている。
  // 毎秒 setState すると React が laps 一覧などツリー全体を再計算し直すため、
  // それ自体が体感できる「一瞬の詰まり」の一因になりうる。
  const stageRef = useRef<HTMLElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)
  const totalRef = useRef<HTMLSpanElement>(null)
  const remainRef = useRef<HTMLSpanElement>(null)
  const lapnoRef = useRef<HTMLDivElement>(null)
  const timeUpRef = useRef(false)

  // タイマーの基準時刻はすべて performance.now()（単調増加）で扱う。
  // Date.now() は端末の時刻同期でずれることがあり、計測には使わない。
  const t0Ref = useRef(0)
  const lastLapAtRef = useRef(0)
  const lapsRef = useRef<number[]>([])
  const startedAtRef = useRef(0)

  // 秒読みと時間切れは1回ずつしか鳴らさない。rAF は毎フレーム走るので
  // 「どこまで読み上げたか」を ref で覚えて重複発話を防ぐ。
  const lastCountedRef = useRef(0)
  const timeUpFiredRef = useRef(false)

  // 秒読みは制限時間より長く設定できないよう丸める
  const finalCountdownSec = Math.min(settings.finalCountdownSec, settings.timeLimitSec)

  useWakeLock(phase !== 'idle')

  useEffect(() => saveSettings(settings), [settings])

  const best = laps.length > 0 ? Math.min(...laps) : null
  const last = laps.length > 0 ? laps[laps.length - 1]! : null

  /* ---------- 計測ロジック ---------- */

  const beginRun = useCallback(
    (t: number) => {
      t0Ref.current = t
      lastLapAtRef.current = t
      lapsRef.current = []
      startedAtRef.current = Date.now()
      lastCountedRef.current = 0
      timeUpFiredRef.current = false
      timeUpRef.current = false
      beginPerfRun(t)
      setLaps([])
      setPhase('running')
      if (stageRef.current) {
        stageRef.current.dataset.warning = 'false'
        stageRef.current.dataset.timeup = 'false'
      }
      if (lapnoRef.current) lapnoRef.current.textContent = 'LAP 1'
      if (settings.hapticEnabled) haptic()
      if (settings.beepEnabled) beep(1320, 160)
    },
    [settings.beepEnabled, settings.hapticEnabled],
  )

  const markLap = useCallback(
    (t: number) => {
      markEvent('lap-tap')
      const elapsed = t - lastLapAtRef.current
      if (elapsed < settings.minLapMs) {
        // 誤タップとして無視したことを一瞬だけ画面に出す
        setRejected(true)
        window.setTimeout(() => setRejected(false), 350)
        return
      }
      const prevBest = lapsRef.current.length > 0 ? Math.min(...lapsRef.current) : Infinity
      const isBest = elapsed < prevBest

      lastLapAtRef.current = t
      lapsRef.current = [...lapsRef.current, elapsed]
      setLaps(lapsRef.current)

      // 振動とビープは軽いので即座に。指を離す前に「刻めた」と分かるのが目的。
      if (settings.hapticEnabled) haptic()
      if (settings.beepEnabled) beep(isBest ? 1568 : 880, isBest ? 140 : 90)
      if (settings.voiceEnabled) {
        // 読み上げは重く、タップ処理の中で走らせると表示が一瞬固まる。
        // ラップ時刻は計測済みなので、発話だけ次のタスクへ逃がす。
        // speakWhenReady を使うのは、開始タップの解錠（click 経由）が
        // まだ終わっていない状態で1本目のラップが打たれた場合に備えるため。
        const lapNumber = settings.announceLapNumber ? lapsRef.current.length : undefined
        const remainMs =
          settings.timeLimitEnabled && settings.announceRemaining
            ? Math.max(0, settings.timeLimitSec * 1000 - lapsRef.current.reduce((a, b) => a + b, 0))
            : undefined
        speakWhenReady(() => announceLap(elapsed, isBest, lapNumber, remainMs))
      }
    },
    [
      settings.minLapMs,
      settings.beepEnabled,
      settings.hapticEnabled,
      settings.voiceEnabled,
      settings.announceLapNumber,
      settings.announceRemaining,
      settings.timeLimitEnabled,
      settings.timeLimitSec,
    ],
  )

  const startCountdown = useCallback(() => {
    setPhase('countdown')
    setCountdown(3)
    let n = 3
    const id = window.setInterval(() => {
      n -= 1
      if (n > 0) {
        setCountdown(n)
        if (settings.beepEnabled) beep(880, 120)
        if (settings.voiceEnabled) speak(String(n))
      } else {
        window.clearInterval(id)
        setCountdown(0)
        if (settings.voiceEnabled) speak('ゴー')
        beginRun(performance.now())
      }
    }, 1000)
    if (settings.beepEnabled) beep(880, 120)
    if (settings.voiceEnabled) speak('3')
  }, [beginRun, settings.beepEnabled, settings.voiceEnabled])

  const stopRun = useCallback(() => {
    cancelSpeech()
    if (lapsRef.current.length > 0) {
      const session: Session = {
        id: newId(),
        startedAt: startedAtRef.current,
        courseName: settings.courseName,
        laps: lapsRef.current,
        timeLimitSec: settings.timeLimitEnabled ? settings.timeLimitSec : undefined,
      }
      setSessions(saveSession(session))
      setLastSession(session)
      setPhase('result')
    } else {
      setLastSession(null)
      setPhase('idle')
    }
  }, [settings.courseName, settings.timeLimitEnabled, settings.timeLimitSec])

  /* ---------- 入力 ---------- */

  // welcome 画面を抜けるときの共通処理（画面タップ・PC のキーボード操作の両方から呼ぶ）。
  // すでに抜けている途中なら何もしない。
  const leaveWelcome = useCallback(() => {
    if (phase !== 'welcome' || welcomeExitingRef.current) return
    welcomeExitingRef.current = true
    setWelcomeExiting(true) // CSS のフェードアウトをここで開始

    let settled = false
    const goIdle = () => {
      if (settled) return
      settled = true
      setPhase('idle')
    }

    if (settings.voiceEnabled) {
      // 読み上げが終わった瞬間に画面を切り替える
      // （フェードの CSS transition もほぼ同じ長さに合わせてある）。
      // onend が来ない異常時に備えて上限も設ける。
      speak('タップタイムラップへようこそ', 1.2, 1, goIdle)
      window.setTimeout(goIdle, 4000)
    } else {
      // 読み上げなしのときはフェードの尺だけ待って切り替える
      window.setTimeout(goIdle, 1600)
    }
  }, [phase, settings.voiceEnabled])

  const handleTap = useCallback(
    (e: React.PointerEvent) => {
      // 入力イベント自身のタイムスタンプを使うことで、
      // ハンドラが呼ばれるまでの遅延ぶんの誤差を避ける。
      const t = e.timeStamp > 0 ? e.timeStamp : performance.now()

      // iOS は最初のユーザー操作の中でしか音声を有効化できない
      unlockAudio()

      if (phase === 'idle') {
        if (settings.countdownEnabled) startCountdown()
        else beginRun(t)
      } else if (phase === 'running') {
        markLap(t)
      }
    },
    [phase, settings.countdownEnabled, startCountdown, beginRun, markLap],
  )

  // PC のブラウザで動作確認できるよう、Space / Enter もタップ扱いにする。
  // 将来 Bluetooth リモコン（キーボードとして認識される機種）を足すときの受け口にもなる。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlay !== 'none') return
      if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return
      if (e.repeat) return
      e.preventDefault()
      const t = e.timeStamp > 0 ? e.timeStamp : performance.now()
      unlockAudio()
      if (phase === 'welcome') {
        leaveWelcome()
      } else if (phase === 'idle') {
        if (settings.countdownEnabled) startCountdown()
        else beginRun(t)
      } else if (phase === 'running') {
        markLap(t)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, overlay, settings.countdownEnabled, leaveWelcome, startCountdown, beginRun, markLap])

  /* ---------- 表示更新 ---------- */

  // rAF の中では DOM のテキストを書き換えるだけに徹する。読み上げや React の
  // 状態更新をここに置くと、iOS では speechSynthesis がメインスレッドを一瞬止め、
  // タイマー表示が固まったり秒読みが飛んだりする（実際に飛ぶ不具合は秒読みを
  // setTimeout ベースの予約に切り出して解決済み）。
  //
  // フレーム間隔が開いた場合は perf.recordStall に記録する。表示が固まる現象は
  // 実機でしか再現しないため、原因を直接見るのではなく、直前に何が起きていたか
  // （発話・ビープ・ラップ操作など）を紐付けて残し、設定画面で確認できるようにする。
  useEffect(() => {
    if (phase !== 'running') return
    const limitMs = settings.timeLimitSec * 1000
    let raf = 0
    let lastFrame = performance.now()

    const tick = (now: number) => {
      const gap = now - lastFrame
      if (gap > STALL_THRESHOLD_MS) recordStall(now, gap)
      lastFrame = now

      const total = now - t0Ref.current

      if (currentRef.current) {
        currentRef.current.textContent = formatLap(now - lastLapAtRef.current)
      }
      if (totalRef.current) {
        totalRef.current.textContent = formatLap(total)
      }
      if (remainRef.current) {
        remainRef.current.textContent = formatLap(Math.max(0, limitMs - total))
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, settings.timeLimitSec])

  // ラップが増えるたびに LAP 表示を更新する。頻度は低い（数秒に1回）ので
  // 通常の state 経由で構わない。時間切れ後は上書きしない。
  useEffect(() => {
    if (timeUpRef.current || !lapnoRef.current) return
    lapnoRef.current.textContent = `LAP ${laps.length + 1}`
  }, [laps])

  /* ---------- 制限時間の秒読み ---------- */

  // 毎フレーム監視する代わりに、走行開始時点で発火時刻を絶対時刻として予約する。
  // 描画が詰まっても秒読みが巻き込まれない。
  useEffect(() => {
    if (phase !== 'running' || !settings.timeLimitEnabled) return
    const limitMs = settings.timeLimitSec * 1000
    const timers: number[] = []

    const at = (elapsedMs: number, fn: () => void) => {
      const delay = elapsedMs - (performance.now() - t0Ref.current)
      timers.push(window.setTimeout(fn, Math.max(0, delay)))
    }

    const announceRemaining = () => {
      // 発火が遅れた場合に備え、予約した数字ではなく実際の残り秒数を読む。
      // 同じ数字を二度読まないよう直前の値を覚えておく。
      const remainSec = Math.round((limitMs - (performance.now() - t0Ref.current)) / 1000)
      if (remainSec < 1 || remainSec > finalCountdownSec) return
      if (remainSec === lastCountedRef.current) return
      lastCountedRef.current = remainSec
      if (stageRef.current) stageRef.current.dataset.warning = 'true'
      if (settings.beepEnabled) beep(1046, 110)
      if (settings.voiceEnabled) speak(String(remainSec))
    }

    for (let n = finalCountdownSec; n >= 1; n--) {
      at(limitMs - n * 1000, announceRemaining)
    }

    at(limitMs, () => {
      if (timeUpFiredRef.current) return
      timeUpFiredRef.current = true
      timeUpRef.current = true
      if (stageRef.current) stageRef.current.dataset.timeup = 'true'
      if (lapnoRef.current) lapnoRef.current.textContent = '制限時間を経過しました'
      if (settings.beepEnabled) beep(392, 700, 0.3)
      // if (settings.voiceEnabled) speak('制限時間を経過しました。', 1.1)
    })

    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [
    phase,
    settings.timeLimitEnabled,
    settings.timeLimitSec,
    settings.beepEnabled,
    settings.voiceEnabled,
    finalCountdownSec,
  ])

  /* ---------- 描画 ---------- */

  if (overlay === 'history') {
    return (
      <HistoryPanel
        sessions={sessions}
        onSessionsChange={setSessions}
        onClose={() => setOverlay('none')}
      />
    )
  }

  if (overlay === 'settings') {
    return (
      <SettingsPanel
        settings={settings}
        onChange={setSettings}
        onClose={() => setOverlay('none')}
      />
    )
  }

  if (phase === 'result' && lastSession) {
    return (
      <div className="panel">
        <header className="panel-head">
          <h2>計測結果</h2>
          <button type="button" className="btn ghost" onClick={() => setPhase('idle')}>
            閉じる
          </button>
        </header>
        <div className="panel-body">
          <SessionCard session={lastSession} />
        </div>
      </div>
    )
  }

  const liveRemain = remainingAtLaps(laps, settings.timeLimitEnabled ? settings.timeLimitSec : undefined)

  return (
    <main
      className="stage"
      ref={stageRef}
      data-phase={phase}
      data-rejected={rejected ? 'true' : 'false'}
      onPointerDown={handleTap}
      // ラップ判定は pointerdown 側だけで完結している。ここでは
      // AudioContext の解錠（すでに解錠済みなら何もしない）と、
      // welcome 画面からの遷移だけを行う。welcome 画面は最初の1回しか
      // 出ないので、ここでの発話はセッション最初の発話になり、その後の
      // タイミングが競合しにくくなる（詳細は下の welcome 画面の説明を参照）。
      onClick={() => {
        unlockAudio()
        leaveWelcome()
      }}
    >
      {phase === 'welcome' && (
        <div className={welcomeExiting ? 'idle welcome welcome-exiting' : 'idle welcome'}>
          <img className="welcome-logo" src="/welcome-logo.png" alt="" />
          <div className="idle-title">TapTimeLap</div>
          <div className="idle-sub">タップして開始</div>
        </div>
      )}

      {phase === 'idle' && (
        // ラップ判定は stage の onPointerDown で拾っている。click で伝播を止めても
        // pointerdown が先に親へ抜けて計測が始まってしまうので、
        // ツールバー全体で pointerdown ごと止める。
        <nav className="topbar" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="btn" onClick={() => setOverlay('history')}>
            履歴
          </button>
          <span className="course">{settings.courseName || 'TapTimeLap'}</span>
          <button type="button" className="btn" onClick={() => setOverlay('settings')}>
            設定
          </button>
        </nav>
      )}

      {phase === 'countdown' && (
        <div className="countdown">{countdown > 0 ? countdown : 'GO'}</div>
      )}

      {phase === 'idle' && (
        <div className="idle">
          <div className="idle-title">画面タップでスタート</div>
          <div className="idle-sub">
            以降はスタートゲート通過ごとにタップ。
            <br />
            停止は右上の STOP をタップ。
          </div>
        </div>
      )}

      {phase === 'running' && (
        <>
          <button
            type="button"
            className="stop"
            // stage の onPointerDown より先に止めないとラップとして拾われる
            onPointerDown={(e) => e.stopPropagation()}
            onClick={stopRun}
          >
            STOP
          </button>

          <div className="readout">
            <div className="current" ref={currentRef}>
              0.00
            </div>
            <div className="lapno" ref={lapnoRef}>
              LAP 1
            </div>
          </div>

          <div className="stats">
            {settings.timeLimitEnabled && (
              <div className="stat">
                <span className="stat-label">REMAIN</span>
                <span className="stat-value remain" ref={remainRef}>
                  {formatLap(settings.timeLimitSec * 1000)}
                </span>
              </div>
            )}
            <div className="stat">
              <span className="stat-label">LAST</span>
              <span className="stat-value">{last !== null ? formatLap(last) : '--'}</span>
              {last !== null && best !== null && last !== best && (
                <span className="stat-delta">{formatDelta(last - best)}</span>
              )}
            </div>
            <div className="stat">
              <span className="stat-label">BEST</span>
              <span className="stat-value best">{best !== null ? formatLap(best) : '--'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">TOTAL</span>
              <span className="stat-value" ref={totalRef}>
                0.00
              </span>
            </div>
          </div>

          <ol className="laplist">
            {laps
              .map((ms, i) => ({ ms, no: i + 1, remain: liveRemain[i] ?? null }))
              .reverse()
              .slice(0, 8)
              .map(({ ms, no, remain }) => (
                <li key={no} className={ms === best ? 'best' : undefined}>
                  <span className="lap-no">{no}</span>
                  <span className="lap-meta">
                    <span className="lap-time">{formatLap(ms)}</span>
                    {remain !== null && <span className="lap-remain">残 {formatLap(remain)}</span>}
                  </span>
                </li>
              ))}
          </ol>
        </>
      )}

      <div className="reject-flash" aria-hidden="true" />
    </main>
  )
}
