import { pad } from '../experiments.js'

// A grid card: bordered screenshot, then index, title and description with no border.
export function card(exp) {
  const el = document.createElement('a')
  el.className = 'card'
  el.href = `/${exp.id}`
  el.innerHTML = `
    <div class="card-thumb">
      ${exp.thumb ? `<img src="${exp.thumb}" alt="" loading="lazy" />` : `<span>${pad(exp.number)}</span>`}
    </div>
    <div class="card-body">
      <h2 class="card-heading"><span class="card-number">${pad(exp.number)}</span><span class="card-title"></span></h2>
      <p class="card-description"></p>
    </div>
  `
  el.querySelector('.card-title').textContent = exp.title
  el.querySelector('.card-description').textContent = exp.description ?? ''
  return el
}
