import './styles/base.css'
import './styles/components.css'
import { findById } from './experiments.js'
import { renderGrid } from './grid.js'
import { renderExperiment } from './shell.js'

const app = document.getElementById('app')
const id = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''))

if (!id) {
  renderGrid(app)
} else {
  const experiment = findById(id)
  if (experiment) {
    renderExperiment(app, experiment)
  } else {
    app.innerHTML = `<p class="header">No experiment "${id}". <a href="/">Back to all</a></p>`
  }
}
