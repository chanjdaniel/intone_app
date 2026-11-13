import { Effect } from 'effect'

// Hands `bytes` to the browser as a file to save on the device, named
// `fileName`: the app's only way out for what it keeps, the backup and
// the starter review's verdicts, each saved where the learner chooses
// and never sent anywhere.
export const saveFile = (
  bytes: Uint8Array,
  fileName: string,
  type: string,
): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type })),
    ),
    url =>
      Effect.sync(() => {
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        link.hidden = true
        document.body.append(link)
        link.click()
        link.remove()
      }),
    // NOTE: the browser reads the file from its URL after the click
    // returns, so the URL is let go a moment later.
    url =>
      Effect.sleep('1 second').pipe(
        Effect.andThen(Effect.sync(() => URL.revokeObjectURL(url))),
      ),
  )
