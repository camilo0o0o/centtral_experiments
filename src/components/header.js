import { pad } from '../experiments.js'

// The grid page header: "● EXPERIMENTOS".
export function siteHeader() {
  const el = document.createElement('header')
  el.className = 'header'
  el.innerHTML = `<h1 class="header-title"><span class="header-dot" aria-hidden="true"></span><span>Experimentos</span></h1>`
  return el
}

// The experiment page header: "← 001 TITLE", with the description below.
export function experimentHeader(exp, parent) {
  const el = document.createElement('header')
  el.className = 'header'
  el.innerHTML = `
    <h1 class="header-title">
      <a href="/" aria-label="All experiments">←</a>
      <span class="header-number">${pad(exp.number)}</span>
      <span class="title"></span>
    </h1>
    <p class="header-description"></p>
  `
  el.querySelector('.title').textContent = exp.title
  const desc = el.querySelector('.header-description')
  desc.textContent = exp.description ?? ''
  if (parent) {
    const link = Object.assign(document.createElement('a'), {
      href: `/${parent.id}`,
      textContent: `forked from ${pad(parent.number)}`,
    })
    desc.append(exp.description ? ' · ' : '', link)
  }
  return el
}
