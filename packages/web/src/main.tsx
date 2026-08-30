import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { PageBoundary } from './paper/PageBoundary.js'
import '@fontsource/press-start-2p'
import '@fontsource/silkscreen'
import '@fontsource/silkscreen/700.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/700.css'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/600.css'
import './ui/chrome.css'

// The last net. The canvas lives inside the tree, so an uncaught render takes the town with it;
// this line is then the whole of what the viewer has, and it says the way back.
createRoot(document.getElementById('root')!).render(
  <PageBoundary
    fallback={<p className="town-lost">The town is out of sight. Reload the page to look again.</p>}
  >
    <App />
  </PageBoundary>,
)
