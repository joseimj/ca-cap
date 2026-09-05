import React from 'react'
import ReactDOM from 'react-dom'
import { ExtensionProvider40 } from '@looker/extension-sdk-react'
import App from './App'
import { baseStyles } from './styles'

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style')
  style.textContent = baseStyles
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'ca-cap-root'
  document.body.appendChild(root)

  ReactDOM.render(
    <ExtensionProvider40 loadingComponent={<div className="cc-loading">…</div>}>
      <App />
    </ExtensionProvider40>,
    root
  )
})
