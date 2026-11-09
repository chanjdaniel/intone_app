import type { Html, HtmlBuilder } from 'foldkit/html'

// How far a cut or an import is, from 0 to 1, as a bar named `label`.
export const progressBar = <ViewMessage>(
  progress: number,
  label: string,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const percent = Math.round(100 * progress)
  return h.div(
    [
      h.Role('progressbar'),
      h.AriaLabel(label),
      h.AriaValuemin(0),
      h.AriaValuemax(100),
      h.AriaValuenow(percent),
      h.Class(
        'h-3 w-full overflow-hidden rounded-full border border-line bg-surface',
      ),
    ],
    [
      h.div([
        h.Class('h-full rounded-full bg-accent motion-safe:transition-all'),
        h.Style({ width: `${percent}%` }),
      ]),
    ],
  )
}
