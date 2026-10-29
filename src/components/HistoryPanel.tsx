import { deleteSession, downloadCsv, sessionsToCsv, type Session } from '../lib/storage'
import { SessionCard } from './SessionCard'

interface Props {
  sessions: Session[]
  onSessionsChange: (next: Session[]) => void
  onClose: () => void
}

export function HistoryPanel({ sessions, onSessionsChange, onClose }: Props) {
  return (
    <div className="panel">
      <header className="panel-head">
        <h2>履歴</h2>
        <div className="panel-head-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={sessions.length === 0}
            onClick={() =>
              downloadCsv(sessionsToCsv(sessions), `taptimelap-${Date.now()}.csv`)
            }
          >
            CSV
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            閉じる
          </button>
        </div>
      </header>

      <div className="panel-body">
        {sessions.length === 0 && <p className="note">まだ記録がありません。</p>}

        {sessions.map((s) => (
          <SessionCard key={s.id} session={s} onDelete={() => onSessionsChange(deleteSession(s.id))} />
        ))}
      </div>
    </div>
  )
}
