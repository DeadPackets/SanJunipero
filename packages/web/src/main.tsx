import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import '@fontsource/press-start-2p'
import '@fontsource/silkscreen'
import '@fontsource/silkscreen/700.css'
import './ui/chrome.css'

createRoot(document.getElementById('root')!).render(<App />)
