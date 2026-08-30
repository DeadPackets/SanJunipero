import WebSocket from 'ws'

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
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    sock.on('open', () => {
      resolve(sock)
    })
    sock.on('error', reject)
  })
