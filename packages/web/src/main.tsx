import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { PageBoundary } from './paper/PageBoundary.js'
import { detachFirstFrame } from './ui/firstFrame.js'
// The latin subset alone: the town's copy is latin, and the full packages carry cyrillic, greek
// and vietnamese `@font-face` blocks that no reader here can reach but every reader must parse.
import '@fontsource/press-start-2p/latin-400.css'
import '@fontsource/silkscreen/latin-400.css'
import '@fontsource/silkscreen/latin-700.css'
import '@fontsource/fraunces/latin-500.css'
import '@fontsource/fraunces/latin-700.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-600.css'
import './ui/chrome.css'

detachFirstFrame()

// The canvas lives inside the tree, so an uncaught render takes the town with it.
createRoot(document.getElementById('root')!).render(
  <PageBoundary
    fallback={<p className="town-lost">The town is out of sight. Reload the page to look again.</p>}
  >
    <App />
  </PageBoundary>,
)
