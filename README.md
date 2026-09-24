# Experiments

Creative coding experiments (p5, three.js, vanilla canvas) on Vite, deployed to Vercel.

```bash
npm run dev                              # http://localhost:5173
npm run new -- p5 "My idea"              # templates: vanilla | p5 | three
npm run fork -- 1 "Flow field v2"        # copies experiment 001, links back to it
```

Each experiment is a folder in `src/experiments/NNN-slug/`:

- `meta.json`: `{ title, description, date, forkedFrom? }`
- `sketch.js`: `export default function ({ container, gui, theme }) { ... }`, where `container` is the stage element, `gui` is a lil-gui instance and `theme` holds the design tokens (`theme.bg`, `theme.ink`, …). Sketches use `theme.bg` for their background by default; set your own color in the sketch to override it.
- `thumb.png`: the grid screenshot. Press **S** on the experiment page (dev only) to save one.

Press **H** to hide or show the controls panel.

## Design system

- `src/styles/tokens.css`: every color, font size, weight and spacing value. Change them here only.
- `src/styles/components.css`: styles for the header, card, frame and controls panel, built from the tokens.
- `src/components/`: `header.js` (grid and experiment headers) and `card.js`, shared across pages.
- `src/theme.js`: passes the tokens to sketches.
