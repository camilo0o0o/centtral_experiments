import { experiments } from './experiments.js'
import { siteHeader } from './components/header.js'
import { card } from './components/card.js'

export function renderGrid(app) {
  document.title = 'Experimentos'
  const grid = document.createElement('main')
  grid.className = 'grid'
  grid.append(...experiments.map(card))
  app.replaceChildren(siteHeader(), grid)
}
