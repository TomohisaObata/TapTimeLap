import { useEffect, useState } from 'react'
import { haptic, hapticBlockedByOs, hasVibrationApi, iosVersion } from '../lib/haptics'
import { isSpeechReady, testSpeech, type SpeechDiagnosis } from '../lib/audio'
import { EVENT_WINDOW_MS, getStalls, type Stall } from '../lib/perf'
import type { Settings } from '../lib/storage'

function describeDiagnosis(d: SpeechDiagnosis): string {
  const voices = `音声 ${d.voiceCount}件 / 日本語 ${d.japaneseVoice ?? 'なし'}`
  switch (d.outcome) {
    case 'ok':
      return `正常に発話しました（${d.elapsedMs}ms）。${voices}`
    case 'unsupported':
      return 'このブラウザは読み上げに対応していません。Safari で開いてください。'
    case 'error':
      return `エラー: ${d.errorCode ?? '不明'}。${voices}`
    case 'silent':
      return `エンジンが応答しません。本体側面の消音スイッチ（着信/サイレント）を解除し、音量を上げてから再試行してください。${voices}`
  }
}

interface Props {
  settings: Settings
  onChange: (next: Settings) => void
  onClose: () => void
}

interface NumberFieldProps {
  label: string
  help: string
  unit: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onCommit: (n: number) => void
}

/**
 * 数値入力。入力途中の空文字を許しつつ、確定できた値だけ親へ返す。
 * 毎入力で確定するので、パネルを閉じる操作で値が失われることがない。
 */
function NumberField({ label, help, unit, value, min, max, disabled, onCommit }: NumberFieldProps) {
  const [text, setText] = useState(String(value))

  useEffect(() => setText(String(value)), [value])

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="num-row">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value
            setText(raw)
            const n = Number(raw)
            if (raw.trim() === '' || !Number.isFinite(n)) return
            onCommit(Math.min(max, Math.max(min, Math.round(n))))
          }}
          onBlur={() => setText(String(value))}
        />
        <span className="unit">{unit}</span>
      </span>
      <span className="field-help">{help}</span>
    </label>
  )
}

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value })

  const [speechResult, setSpeechResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  // パネルを開くたびに最新の記録を読み直す。走行中は変わらないので都度の再取得で十分。
  const [stalls, setStalls] = useState<Stall[]>(() => getStalls())

  const runSpeechTest = async () => {
    setTesting(true)
    setSpeechResult('テスト中…')
    setSpeechResult(describeDiagnosis(await testSpeech()))
    setTesting(false)
  }

  return (
    <div className="panel">
      <header className="panel-head">
        <h2>設定</h2>
        <button type="button" className="btn ghost" onClick={onClose}>
          閉じる
        </button>
      </header>

      <div className="panel-body">
        <label className="field">
          <span className="field-label">コース名</span>
          <input
            type="text"
            value={settings.courseName}
            placeholder="例: JDL Round 1"
            onChange={(e) => set('courseName', e.target.value)}
          />
          <span className="field-help">履歴と CSV に記録されます</span>
        </label>

        <label className="field">
          <span className="field-label">
            最小ラップ時間 <strong>{(settings.minLapMs / 1000).toFixed(1)}秒</strong>
          </span>
          <input
            type="range"
            min={500}
            max={20000}
            step={500}
            value={settings.minLapMs}
            onChange={(e) => set('minLapMs', Number(e.target.value))}
          />
          <span className="field-help">
            この時間内の2回目のタップは無視します。コースの最速ラップより少し短い値にすると
            誤タップを防げます。
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.voiceEnabled}
            onChange={(e) => set('voiceEnabled', e.target.checked)}
          />
          <span>ラップタイムを読み上げる</span>
        </label>

        <div className="field">
          <button type="button" className="btn" disabled={testing} onClick={runSpeechTest}>
            読み上げをテスト
          </button>
          {speechResult && <span className="field-help result">{speechResult}</span>}
          <span className="field-help">
            動作確認: {isSpeechReady() ? '確認済み（発話が鳴っています）' : '未確認（まだ一度も鳴っていません）'}
          </span>
          <span className="field-help">
            音が出ない場合はここで原因を確認できます。iOS は消音スイッチで読み上げが止まることが
            あります。走行を開始すると「計測開始します」と案内が入りますが、それも鳴らない場合は
            このボタンで確認してください。
          </span>
        </div>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.announceLapNumber}
            disabled={!settings.voiceEnabled}
            onChange={(e) => set('announceLapNumber', e.target.checked)}
          />
          <span>
            周回数も読み上げる
            <span className="inline-help">
              {settings.announceLapNumber ? '「ラップ3、12.34、ベスト」' : '「12.34、ベスト」'}
            </span>
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.beepEnabled}
            onChange={(e) => set('beepEnabled', e.target.checked)}
          />
          <span>ビープ音を鳴らす（ベスト更新時は高音）</span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.hapticEnabled}
            onChange={(e) => set('hapticEnabled', e.target.checked)}
          />
          <span>タップ時に振動させる</span>
        </label>

        <div className="field">
          <button type="button" className="btn" onClick={() => haptic()}>
            振動をテスト
          </button>
          {hapticBlockedByOs() && (
            <span className="field-help result">
              この端末（iOS {iosVersion()?.major}.{iosVersion()?.minor}）では振動しません。
              iOS 26.5 で Apple が Web からの振動を塞いだためで、設定では回避できません。
            </span>
          )}
          <span className="field-help">
            iOS は Web 標準の振動 API に対応しておらず、Safari のスイッチ要素を使った代替手段で
            鳴らしています。iOS 17.4〜26.4 でのみ動作します。
            {hasVibrationApi() ? '（この端末は標準 API に対応しています）' : ''}
          </span>
        </div>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.countdownEnabled}
            onChange={(e) => set('countdownEnabled', e.target.checked)}
          />
          <span>3-2-1-GO のカウントダウンで開始する</span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.timeLimitEnabled}
            onChange={(e) => set('timeLimitEnabled', e.target.checked)}
          />
          <span>制限時間を使う</span>
        </label>

        <NumberField
          label="制限時間"
          unit="秒"
          value={settings.timeLimitSec}
          min={5}
          max={3600}
          disabled={!settings.timeLimitEnabled}
          onCommit={(n) => set('timeLimitSec', n)}
          help="スタートからの累計時間で判定します。経過すると「制限時間を経過しました。」と読み上げます。"
        />

        <NumberField
          label="終了前カウントダウン"
          unit="秒前から"
          value={settings.finalCountdownSec}
          min={0}
          max={60}
          disabled={!settings.timeLimitEnabled}
          onCommit={(n) => set('finalCountdownSec', n)}
          help={
            settings.finalCountdownSec > 0
              ? `${Math.max(0, settings.timeLimitSec - Math.min(settings.finalCountdownSec, settings.timeLimitSec))}秒経過した時点から、残り秒数を読み上げます。0 にすると秒読みなしです。`
              : '0 のとき秒読みはせず、制限時間の経過だけを知らせます。'
          }
        />

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.announceRemaining}
            disabled={!settings.voiceEnabled || !settings.timeLimitEnabled}
            onChange={(e) => set('announceRemaining', e.target.checked)}
          />
          <span>
            ラップごとに残り時間も読み上げる
            <span className="inline-help">
              {settings.announceRemaining ? '「12.34、残り時間45.00、ベスト」' : '「12.34、ベスト」'}
            </span>
          </span>
        </label>

        <div className="field">
          <span className="field-label">表示の詰まり具合（診断）</span>
          <button type="button" className="btn ghost" onClick={() => setStalls(getStalls())}>
            最新の記録に更新
          </button>
          {stalls.length === 0 ? (
            <span className="field-help">
              直前の走行では 80ms 以上の詰まりは記録されていません。走行後にこのボタンで確認できます。
            </span>
          ) : (
            <ol className="stall-list">
              {stalls.map((s, i) => (
                <li key={i} className="field-help result">
                  <div>
                    走行開始 {(s.atMs / 1000).toFixed(1)}秒地点で <strong>{s.durationMs}ms</strong> 停止
                  </div>
                  {s.events.length === 0 ? (
                    <div className="stall-events-empty">
                      前後{EVENT_WINDOW_MS / 1000}秒以内に記録されたイベントなし
                    </div>
                  ) : (
                    <ul className="stall-events">
                      {s.events.map((e, j) => (
                        <li key={j}>
                          {e.offsetMs <= 0
                            ? `${(-e.offsetMs / 1000).toFixed(2)}秒前`
                            : `${(e.offsetMs / 1000).toFixed(2)}秒後`}
                          : {e.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
          <span className="field-help">
            タイマー表示が一瞬止まる現象の切り分け用です。走行中に画面の更新が 80ms 以上止まった
            箇所について、その前後{EVENT_WINDOW_MS / 1000}秒以内に起きたこと（発話の開始/終了・
            ビープ・振動・ラップ操作）を時系列で記録します。この一覧の内容をそのまま伝えていただくと
            原因を特定しやすくなります。
          </span>
        </div>

        <p className="note">
          消音スイッチが ON でも音が出るように設定していますが、iOS のバージョンによっては
          鳴らないことがあります。その場合は消音を解除してください。
        </p>
      </div>
    </div>
  )
}
