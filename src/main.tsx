import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/500.css'
import '@fontsource/eb-garamond/700.css'
import '@fontsource/shippori-mincho/500.css'
import '@fontsource/shippori-mincho/700.css'
import { App } from './ui/App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
