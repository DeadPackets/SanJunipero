// Fixture code shared by the gateway tests. Assertions live in the test files.
import WebSocket from 'ws'

/** Poll `cond` until it holds. The timeout is required: a gate that waits 30 s and a boot that
 *  waits 12 s must not share a default. */
export const until = async (cond: () => boolean, timeoutMs: number): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** An open viewer socket, or a rejection — never a half-open one. */
export const connect = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    sock.on('open', () => {
      resolve(sock)
    })
    sock.on('error', reject)
  })
