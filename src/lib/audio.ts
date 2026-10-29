import { speakableLap } from './format'
import { markEvent } from './perf'

// iOS Safari は AudioContext / speechSynthesis の初回起動にユーザー操作を要求する。
// さらに既定ではサイレントスイッチ（消音モード）で Web Audio がミュートされるため、
// navigator.audioSession.type = 'playback' を宣言してスイッチを無視させる。
// （audioSession は Safari 16.4+ で利用可能。未対応環境では何もしない）

let ctx: AudioContext | null = null
let unlocked = false

// 実際に発話が鳴ったことを一度でも確認できたか（診断表示用）。
// speak() の onstart が一度でも発火すれば true になる。App.tsx が開始タップの
// click イベントから（案内が不要なときは無音で）speak() を呼んでおり、
// それがセッション最初の解錠確認を兼ねる。
let speechReady = false

interface AudioSessionLike {
  type: string
}

function claimPlaybackSession(): void {
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession
  if (session) session.type = 'playback'
}

/**
 * ユーザー操作（タップ・クリック）の中から必ず一度呼ぶこと。
 * これを通さないと iOS では以降のビープも読み上げも鳴らない。
 */
export function unlockAudio(): void {
  if (unlocked) return
  claimPlaybackSession()
  loadVoices()

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor) {
    ctx = new Ctor()
    // 無音バッファを1回流して出力パイプラインを起こす
    const buffer = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
    void ctx.resume()
  }
  unlocked = true
}

let jaVoice: SpeechSynthesisVoice | null = null

/**
 * iOS は getVoices() が初回は空配列を返し、あとから voiceschanged で埋まる。
 * lang 指定だけだと音声が選ばれないことがあるので、日本語音声を明示的に掴む。
 */
function loadVoices(): void {
  if (!('speechSynthesis' in window)) return
  const pick = () => {
    const voices = window.speechSynthesis.getVoices()
    jaVoice =
      voices.find((v) => v.lang === 'ja-JP') ?? voices.find((v) => v.lang.startsWith('ja')) ?? null
  }
  pick()
  window.speechSynthesis.addEventListener('voiceschanged', pick)
}

/** 短いビープ。ラップ確定やカウントダウンの触覚代わりに使う。 */
export function beep(frequency = 880, durationMs = 90, gain = 0.25): void {
  markEvent('beep')
  const audioCtx = ctx
  if (!audioCtx) return

  const play = () => {
    const osc = audioCtx.createOscillator()
    const amp = audioCtx.createGain()
    osc.type = 'square'
    osc.frequency.value = frequency

    const now = audioCtx.currentTime
    const end = now + durationMs / 1000
    // クリックノイズを避けるため立ち上がり/立ち下がりに短いランプを入れる
    amp.gain.setValueAtTime(0, now)
    amp.gain.linearRampToValueAtTime(gain, now + 0.005)
    amp.gain.setValueAtTime(gain, end - 0.01)
    amp.gain.linearRampToValueAtTime(0, end)

    osc.connect(amp).connect(audioCtx.destination)
    osc.start(now)
    osc.stop(end + 0.02)
  }

  if (audioCtx.state === 'running') {
    play()
  } else {
    // resume() は非同期。完了を待たずに鳴らそうとすると、起動直後の
    // 1回目だけ間に合わず無音になることがある（実機で確認）。
    void audioCtx.resume().then(play)
  }
}

function buildUtterance(text: string, rate: number, volume: number): SpeechSynthesisUtterance {
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'ja-JP'
  if (jaVoice) utter.voice = jaVoice
  utter.rate = rate
  utter.volume = volume
  return utter
}

/**
 * ラップタイムを日本語で読み上げる。読み上げ中の古い発話は破棄する。
 * onEnd は発話が終わった（またはエラー・非対応で鳴らせなかった）ときに1回だけ呼ばれる。
 * 画面遷移を読み上げの長さに合わせたいときに使う。
 */
export function speak(text: string, rate = 1.25, volume = 1, onEnd?: () => void): void {
  markEvent(`speak-call:${text}`)
  if (!('speechSynthesis' in window)) {
    onEnd?.()
    return
  }
  const synth = window.speechSynthesis
  const utter = buildUtterance(text, rate, volume)
  // 詰まりの原因切り分け用。発話の「開始」と「終了」を別々に記録することで、
  // 表示の詰まりが発話中に起きているのか、発話が終わった後の後処理で
  // 起きているのかを区別できるようにする。
  utter.onstart = () => {
    speechReady = true
    markEvent(`speak-start:${text}`)
  }
  utter.onend = () => {
    markEvent(`speak-end:${text}`)
    onEnd?.()
  }
  utter.onerror = () => {
    markEvent(`speak-error:${text}`)
    onEnd?.()
  }

  // iOS は cancel() の直後すぐに speak() すると、発話ごと捨てられたり、新しい発話の
  // 冒頭が欠けて聞こえたりすることがある。実際に喋っている時だけ打ち切り、
  // 少し間を置いてから投げ直す。
  if (synth.speaking || synth.pending) {
    synth.cancel()
    window.setTimeout(() => synth.speak(utter), 80)
  } else {
    synth.speak(utter)
  }
}

export interface SpeechDiagnosis {
  outcome: 'ok' | 'unsupported' | 'error' | 'silent'
  errorCode?: string
  voiceCount: number
  japaneseVoice: string | null
  elapsedMs: number
}

/**
 * 実機で読み上げが鳴らない原因を切り分けるための自己診断。
 * 発話が始まったか・エラーが返ったか・そもそも無反応かを見分ける。
 */
export function testSpeech(): Promise<SpeechDiagnosis> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve({ outcome: 'unsupported', voiceCount: 0, japaneseVoice: null, elapsedMs: 0 })
      return
    }

    unlockAudio()
    loadVoices()

    const synth = window.speechSynthesis
    synth.cancel()

    const started = performance.now()
    const voices = synth.getVoices()
    const base = {
      voiceCount: voices.length,
      japaneseVoice: jaVoice ? `${jaVoice.name} (${jaVoice.lang})` : null,
    }

    let settled = false
    const finish = (outcome: SpeechDiagnosis['outcome'], errorCode?: string) => {
      if (settled) return
      settled = true
      resolve({ ...base, outcome, errorCode, elapsedMs: Math.round(performance.now() - started) })
    }

    const utter = buildUtterance('読み上げのテストです', 1.1, 1)
    utter.onstart = () => {
      speechReady = true
      finish('ok')
    }
    utter.onerror = (e) => finish('error', e.error)
    // onstart が一度も来ない = エンジンが応答していない（消音スイッチ等）
    window.setTimeout(() => finish('silent'), 3000)

    window.setTimeout(() => synth.speak(utter), 30)
  })
}

/**
 * ラップタイムを「ラップ3、12.34、残り時間45.00、ベスト」の順で読み上げる。
 * lapNumber / remainMs は省略可（それぞれ周回数・残り時間の読み上げを行わない）。
 */
export function announceLap(
  lapMs: number,
  isBest: boolean,
  lapNumber?: number,
  remainMs?: number,
): void {
  const parts: string[] = []
  if (lapNumber !== undefined) parts.push(`ラップ${lapNumber}`)
  parts.push(speakableLap(lapMs))
  if (remainMs !== undefined) parts.push(`残り時間${speakableLap(remainMs)}`)
  if (isBest) parts.push('ベスト')
  // 読点で区切ると読み上げエンジンが句切りとして扱い、間が空く。
  // 半角スペースだと日本語音声では詰めて読まれてしまう。
  speak(parts.join('、'))
}

export function cancelSpeech(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

/** 読み上げが実際に鳴ることを確認できているか（診断表示用）。 */
export function isSpeechReady(): boolean {
  return speechReady
}

/**
 * 解錠（speechReady）が確認できるまで少し待ってから fn を呼ぶ。
 *
 * 開始タップの解錠発話は click 経由で少し遅れて実行される。その直後に
 * 1本目のラップを打つと、解錠が完了する前にラップの読み上げを試みてしまい、
 * 無視されることがあった（実機で確認）。解錠済みならほぼ即座に、
 * 未確認ならポーリングして少し待つ（待ちすぎないよう上限あり。それでも
 * 解錠できていなければ、別の原因を疑うべきなのでそのまま呼んで諦める）。
 */
export function speakWhenReady(fn: () => void, maxWaitMs = 1500): void {
  window.setTimeout(() => {
    if (speechReady) {
      fn()
      return
    }
    const start = performance.now()
    const poll = () => {
      if (speechReady || performance.now() - start > maxWaitMs) {
        fn()
      } else {
        window.setTimeout(poll, 50)
      }
    }
    poll()
  }, 0)
}
