// Every folder in src/experiments is an experiment. Metadata and thumbnails are
// loaded eagerly for the grid; sketches are lazy so each one gets its own bundle.
const metas = import.meta.glob('./experiments/*/meta.json', { eager: true, import: 'default' })
const thumbs = import.meta.glob('./experiments/*/thumb.webp', { eager: true, import: 'default' })
const sketches = import.meta.glob('./experiments/*/sketch.js')

export const experiments = Object.entries(metas)
  .map(([file, meta]) => {
    const dir = file.slice(0, file.lastIndexOf('/'))
    const id = dir.split('/').pop()
    return {
      ...meta,
      id,
      number: parseInt(id, 10),
      thumb: thumbs[`${dir}/thumb.webp`],
      load: sketches[`${dir}/sketch.js`],
    }
  })
  .sort((a, b) => a.number - b.number)

export const findById = (id) => experiments.find((e) => e.id === id)
export const findByNumber = (n) => experiments.find((e) => e.number === n)
export const pad = (n) => String(n).padStart(3, '0')
