# CLAUDE.md

A Vite site of creative-coding experiments (p5.js, three.js, vanilla canvas), written in plain JavaScript with no framework. It is live on Vercel. The home page is a grid of experiments. Each experiment opens in a shared page with a header, a bordered canvas and a lil-gui controls panel.

## Commands

```bash
npm run dev                          # dev server
npm run build                        # production build; run it before saying a change is done
npm run new -- <vanilla|p5|three> "Title"
npm run fork -- <number> "Title"     # copies experiment <number>, sets forkedFrom
```

## Scope: what you may change

- **Without asking:** files inside the experiment folder you are working on (`src/experiments/NNN-slug/`).
- **Only with the user's approval:** everything else. That includes the site shell (`src/*.js`, `src/components/`),
  styles and tokens (`src/styles/`), `templates/`, `scripts/`, `vite.config.js`, `vercel.json`, `package.json`
  (adding a dependency counts), and other experiments' folders. Explain the change and why, then wait for a yes.

## Starting an experiment

- Always create experiments with `npm run new` or `npm run fork`. Never create or number folders by hand.
- Folders are `src/experiments/NNN-slug/`. The number is permanent and the folder name is the public URL
  (`/001-flow-field`), so never rename, renumber or delete an existing experiment folder.
- A fork is a full copy. Change only the new folder, never its parent.
- Fill in `description` in `meta.json`. It shows on the grid card and in the page header.

Each experiment folder contains:
- `meta.json`: `{ "title", "description", "date", "forkedFrom"? }`
- `sketch.js`: the experiment code
- `thumb.webp`: the grid screenshot (see Thumbnails)

## The sketch contract

```js
// src/experiments/NNN-slug/sketch.js
export default function ({ container, gui, theme }) {
  const bg = theme.bg // override here for a different canvas color
  const params = { speed: 1 }
  gui.add(params, 'speed', 0, 5)
  // create the canvas inside `container`
}
```

- `container`: the element the experiment lives in. Size the canvas to `container.clientWidth/clientHeight`,
  not `window`. Handle resizing: p5 `windowResized`, or a `ResizeObserver` for three.js and vanilla.
- `gui`: a lil-gui instance. Add controls at the top level of the function, synchronously. The page checks for
  controls right after the sketch returns and hides the panel if there are none, so controls added inside
  p5's `setup` or an async callback will be missed. If a GUI callback needs something created later, call it
  through a variable that gets assigned later: `.onChange(() => reset())`.
- `theme`: design tokens (`bg`, `ink`, `muted`, `font`). Use `theme.bg` as the background unless the
  experiment deliberately needs a different one.
- p5: use instance mode only, `new p5((p) => { ... }, container)`. Global mode is not supported.
- three.js: create the renderer with `preserveDrawingBuffer: true`, otherwise thumbnails come out blank.
- No cleanup code is needed. Going between pages is a full page load.
- Don't bind the `s` or `h` keys in a sketch. The page uses them (save thumbnail, hide controls).
- Don't touch anything outside `container` (body, header, other elements).

## Thumbnails

- Pressing `S` on an experiment page in dev saves an 800px WebP to `thumb.webp`. A person has to do this
  in Chrome or Firefox (Safari can't save WebP). You can't take the screenshot, so when an experiment
  is ready, ask the user to press S.
- Don't add PNG or JPG thumbnails. The grid only reads `thumb.webp`.

## Dependencies and bundle size

- All libraries go in the root `package.json` (adding one needs approval, see Scope).
- Import libraries only from a sketch (`src/experiments/*/sketch.js`). Sketches load lazily, so each library
  downloads only on the experiments that use it. Importing p5 or three from shared code (`src/*.js`,
  `src/components/`) would add it to every page, including the grid.

## Design system (the site, not the sketches)

- Every color, font size, weight and spacing value lives in `src/styles/tokens.css`. Change values there;
  never hardcode them in other CSS files.
- Styles for the header, card, frame and controls panel are in `src/styles/components.css`. Their markup is
  built in `src/components/header.js` and `src/components/card.js`.
- The only font is IBM Plex Mono, bundled via `@fontsource`. It has no ● or ← glyphs, which is why the
  header dot is drawn with CSS.
- Changing `templates/` only affects experiments created afterwards.

## Deploy

The site is live on Vercel. Every push to `main` on GitHub (`camilo0o0o/centtral_experiments`) deploys to
production, so run `npm run build` before pushing. `vercel.json` sends every URL to `index.html`; the router
in `src/main.js` decides which page to show.
