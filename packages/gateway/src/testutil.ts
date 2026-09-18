import WebSocket, { type RawData } from 'ws'
import { frameText } from './http.js'

/** The timeout is required: a gate that waits 30 s and a boot that waits 12 s share no default. */
export const until = async (cond: () => boolean, timeoutMs: number): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

export const connect = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`, { handshakeTimeout: 5_000 })
    sock.on('open', () => {
      resolve(sock)
    })
    sock.on('error', reject)
  })

export function nextFrame(sock: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      sock.off('message', received)
      sock.off('close', closed)
      sock.off('error', failed)
    }
    const received = (data: RawData) => {
      cleanup()
      resolve(frameText(data))
    }
    const failed = (error: Error) => {
      cleanup()
      reject(error)
    }
    const closed = (code: number) => {
      failed(new Error(`Socket closed before the next frame: ${code}`))
    }
    const timer = setTimeout(() => {
      failed(new Error(`No frame within 5000ms, socket state ${sock.readyState}`))
    }, 5_000)
    sock.once('message', received)
    sock.once('close', closed)
    sock.once('error', failed)
  })
}
