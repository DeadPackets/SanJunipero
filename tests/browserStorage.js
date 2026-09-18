// Node 26 exposes storage globals that shadow happy-dom's per-window storage.
if (typeof window !== 'undefined' && 'happyDOM' in window) {
  const { Storage } = await import('happy-dom')
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: new Storage(),
    })
  }
}
