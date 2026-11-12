// What went wrong, in words, from anything thrown or rejected: an Error's
// message, or the thing itself as text. Every folder may import it.
export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
