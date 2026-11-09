// Allowed: the bridge opens the dev library by a dynamic import, inside a
// development-only branch the production build drops.
export const load = () =>
  import.meta.env.DEV ? import('./dev/library') : Promise.resolve(undefined)
