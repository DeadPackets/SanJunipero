import { useEffect, useState } from 'react'
import { stageKeyAllowed } from '../stage/useStageKeys.js'

const FPS_WINDOW_MS = 60_000
const FPS_SAMPLE_MS = 500

// The town's own health meter — ships in every build, toggled with Shift+P. NOT `?`: that is
// where a person looks for the key map, and NOT `f`, which is fullscreen on the same window.
export function FpsOverlay() {
  const [visible, setVisible] = useState(false)
  const [current, setCurrent] = useState(0)
  const [avg, setAvg] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.shiftKey || e.key.toLowerCase() !== 'p' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (!stageKeyAllowed(t?.tagName ?? '', t?.isContentEditable ?? false)) return
      setVisible((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    let raf = 0
    let frames = 0
    let windowStart = performance.now()
    const samples: { t: number; fps: number }[] = []
    const step = (t: number): void => {
      frames++
      if (t - windowStart >= FPS_SAMPLE_MS) {
        const fps = (frames * 1000) / (t - windowStart)
        samples.push({ t, fps })
        while (samples.length > 0 && t - samples[0]!.t > FPS_WINDOW_MS) samples.shift()
        setCurrent(Math.round(fps))
        setAvg(Math.round((samples.reduce((s, x) => s + x.fps, 0) / samples.length) * 10) / 10)
        frames = 0
        windowStart = t
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [visible])

  if (!visible) return null
  return (
    <div className="fps-overlay" role="status" aria-label="Frames per second">
      <span className="fps-now">{current} fps</span>
      <span className="fps-avg">{avg ?? '—'} avg 60s</span>
    </div>
  )
}
