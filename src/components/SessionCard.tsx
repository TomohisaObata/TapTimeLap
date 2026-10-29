import { formatDateTime, formatLap } from '../lib/format'
import type { Session } from '../lib/storage'

interface Props {
  session: Session
  /** 渡した場合のみ削除ボタンを出す。走行直後の結果表示では渡さない。 */
  onDelete?: () => void
}

function stats(laps: number[]) {
  if (laps.length === 0) return null
  const best = Math.min(...laps)
  const total = laps.reduce((a, b) => a + b, 0)
  return { best, total, avg: total / laps.length }
}

/** 履歴の1件と、走行直後の「計測結果」で共通して使うカード表示。 */
export function SessionCard({ session, onDelete }: Props) {
  const st = stats(session.laps)

  return (
    <article className="session">
      <div className="session-head">
        <div>
          <div className="session-title">{session.courseName || '（コース名なし）'}</div>
          <div className="session-date">{formatDateTime(session.startedAt)}</div>
        </div>
        {onDelete && (
          <button type="button" className="btn ghost danger" onClick={onDelete}>
            削除
          </button>
        )}
      </div>

      {st && (
        <div className="session-stats">
          <span>トータル {formatLap(st.total)}</span>
          <span>ベスト {formatLap(st.best)}</span>
          <span>平均 {formatLap(st.avg)}</span>
        </div>
      )}

      <ol className="session-laps">
        {session.laps.map((ms, i) => (
          <li key={i} className={st && ms === st.best ? 'best' : undefined}>
            <span className="lap-no">{i + 1}</span>
            <span className="lap-time">{formatLap(ms)}</span>
          </li>
        ))}
      </ol>
    </article>
  )
}
