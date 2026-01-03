import { useEffect, useMemo, useRef, useState } from "react"
import { buildFrameBits, extractFrames } from "./audio/codec"
import { profiles } from "./audio/profiles"
import { bandPower, frequencyToIndex } from "./audio/signal"

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.slice(i, i + chunk)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

type ReceivedMessage = {
  id: string
  receivedAt: string
  size: number
  preview: string
  base64: string
}

export default function App() {
  const [profileId, setProfileId] = useState(profiles[0].id)
  const profile = useMemo(() => profiles.find((item) => item.id === profileId) ?? profiles[0], [profileId])
  const [f0, setF0] = useState(profile.f0)
  const [f1, setF1] = useState(profile.f1)
  const [bitDurationMs, setBitDurationMs] = useState(profile.bitDurationMs)
  const [volume, setVolume] = useState(0.4)
  const [payloadText, setPayloadText] = useState("Bonjour depuis SoundWires")
  const [sending, setSending] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [signalDelta, setSignalDelta] = useState(0)
  const [bitCount, setBitCount] = useState(0)
  const [received, setReceived] = useState<ReceivedMessage[]>([])
  const intervalRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const bitBufferRef = useRef<number[]>([])

  useEffect(() => {
    setF0(profile.f0)
    setF1(profile.f1)
    setBitDurationMs(profile.bitDurationMs)
  }, [profile])

  const playBits = async (bits: number[]) => {
    const context = new AudioContext()
    const osc = context.createOscillator()
    const gain = context.createGain()
    const startTime = context.currentTime + 0.05
    const bitDuration = bitDurationMs / 1000
    osc.type = "sine"
    gain.gain.setValueAtTime(0, startTime - 0.02)
    osc.connect(gain).connect(context.destination)
    for (let i = 0; i < bits.length; i += 1) {
      const time = startTime + i * bitDuration
      osc.frequency.setValueAtTime(bits[i] === 1 ? f1 : f0, time)
      gain.gain.setValueAtTime(volume, time)
    }
    const endTime = startTime + bits.length * bitDuration
    gain.gain.setValueAtTime(volume, endTime)
    gain.gain.linearRampToValueAtTime(0, endTime + 0.02)
    osc.start(startTime)
    osc.stop(endTime + 0.05)
    await new Promise<void>((resolve) => {
      osc.onended = () => {
        context.close()
        resolve()
      }
    })
  }

  const handleSend = async () => {
    if (sending || payloadText.trim().length === 0) return
    setSending(true)
    const payload = new TextEncoder().encode(payloadText)
    const bits = buildFrameBits(payload)
    await playBits(bits)
    setSending(false)
  }

  const handleStartReceiving = async () => {
    if (receiving) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 4096
    source.connect(analyser)
    analyserRef.current = analyser
    audioContextRef.current = context
    streamRef.current = stream
    bitBufferRef.current = []
    setBitCount(0)
    setReceiving(true)
    const interval = window.setInterval(() => {
      const analyserNode = analyserRef.current
      const ctx = audioContextRef.current
      if (!analyserNode || !ctx) return
      const data = new Float32Array(analyserNode.frequencyBinCount)
      analyserNode.getFloatFrequencyData(data)
      const index0 = frequencyToIndex(f0, ctx.sampleRate, analyserNode.fftSize)
      const index1 = frequencyToIndex(f1, ctx.sampleRate, analyserNode.fftSize)
      const power0 = bandPower(data, index0)
      const power1 = bandPower(data, index1)
      const bit = power1 > power0 ? 1 : 0
      const delta = power1 - power0
      setSignalDelta(delta)
      bitBufferRef.current.push(bit)
      setBitCount((count) => count + 1)
      const { frames, remaining } = extractFrames(bitBufferRef.current)
      bitBufferRef.current = remaining
      if (frames.length > 0) {
        const decoder = new TextDecoder()
        setReceived((items) => [
          ...frames.map((frame) => {
            const preview = decoder.decode(frame.slice(0, 200))
            const base64 = toBase64(frame.slice(0, 512))
            return {
              id: crypto.randomUUID(),
              receivedAt: new Date().toLocaleTimeString(),
              size: frame.length,
              preview,
              base64
            }
          }),
          ...items
        ])
      }
    }, bitDurationMs)
    intervalRef.current = interval
  }

  const handleStopReceiving = async () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
    }
    intervalRef.current = null
    analyserRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setReceiving(false)
  }

  const bitrate = Math.round(1000 / bitDurationMs)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold">SoundWires</h1>
            <p className="text-slate-300">
              POC Vite + React + Tailwind pour transférer des données via des signaux audio entre deux pages.
            </p>
          </header>
          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-xl font-semibold">Émetteur</h2>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-2">
                  <label className="text-sm text-slate-300">Message</label>
                  <textarea
                    className="min-h-[140px] rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm"
                    value={payloadText}
                    onChange={(event) => setPayloadText(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm text-slate-300">Profil</label>
                  <select
                    className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-sm"
                    value={profileId}
                    onChange={(event) => setProfileId(event.target.value)}
                  >
                    {profiles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2 text-sm text-slate-300">
                    F0 (Hz)
                    <input
                      type="number"
                      value={f0}
                      onChange={(event) => setF0(Number(event.target.value))}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-2"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-slate-300">
                    F1 (Hz)
                    <input
                      type="number"
                      value={f1}
                      onChange={(event) => setF1(Number(event.target.value))}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-2"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-slate-300">
                    Bit (ms)
                    <input
                      type="number"
                      min={20}
                      value={bitDurationMs}
                      onChange={(event) => setBitDurationMs(Number(event.target.value))}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-2"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-2 text-sm text-slate-300">
                  Volume
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(event) => setVolume(Number(event.target.value))}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                  <span>Débit théorique: {bitrate} bps</span>
                  <span>Charge: {payloadText.length} caractères</span>
                </div>
                <button
                  className="rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700"
                  onClick={handleSend}
                  disabled={sending}
                >
                  {sending ? "Émission en cours" : "Émettre le message"}
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-xl font-semibold">Récepteur</h2>
              <div className="mt-4 grid gap-4">
                <div className="flex items-center gap-3">
                  <button
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
                    onClick={handleStartReceiving}
                    disabled={receiving}
                  >
                    Démarrer
                  </button>
                  <button
                    className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleStopReceiving}
                    disabled={!receiving}
                  >
                    Arrêter
                  </button>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Signal Δ (dB)</span>
                    <span className="text-slate-100">{signalDelta.toFixed(1)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>Bits observés</span>
                    <span className="text-slate-100">{bitCount}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {received.length === 0 ? (
                    <p className="text-sm text-slate-400">Aucun message reçu.</p>
                  ) : (
                    received.map((message) => (
                      <div key={message.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>{message.receivedAt}</span>
                          <span>{formatBytes(message.size)}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-200">{message.preview}</p>
                        <p className="mt-2 break-all text-xs text-slate-500">{message.base64}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
            <h2 className="text-lg font-semibold text-slate-100">Mode d'emploi rapide</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>Ouvrir cette page sur deux onglets ou deux appareils.</li>
              <li>Démarrer le récepteur et autoriser le micro.</li>
              <li>Émettre un message depuis l'émetteur.</li>
              <li>Ajuster les fréquences et la durée de bit selon l'environnement.</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}
