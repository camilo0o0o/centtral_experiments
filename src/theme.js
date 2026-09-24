// Tokens exposed to sketches. Values come from src/styles/tokens.css so CSS stays the source of truth.
// Read lazily so the stylesheet is guaranteed to be applied first.
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export const theme = {
  get bg() { return css('--canvas-bg') },
  get ink() { return css('--color-ink') },
  get muted() { return css('--color-muted') },
  get font() { return css('--font-mono') },
}
