import { Effect, Schema } from 'effect'
import { Mount } from 'foldkit'

import { Message } from './message'

// The bridge from the app to the /dev component library in `./dev/`. The
// library is never imported statically (lint refuses it), only here, inside
// a development-only branch, so a production build drops it; the build's
// dev library guard fails any production build that still holds a module
// from `./dev/`.

export const MountDevLibrary = Mount.define('MountDevLibrary', {
  args: { maybeEntry: Schema.Option(Schema.String) },
  messages: [Message.CompletedMountDevLibrary, Message.FailedMountDevLibrary],
  execute: ({ element, maybeEntry }) =>
    import.meta.env.DEV
      ? Effect.tryPromise(() => import('./dev/library')).pipe(
          Effect.flatMap(library => library.open(element, maybeEntry)),
          Effect.as(Message.CompletedMountDevLibrary()),
          Effect.catch(error =>
            Effect.succeed(
              Message.FailedMountDevLibrary({
                reason: String(error),
              }),
            ),
          ),
        )
      : Effect.succeed(
          Message.FailedMountDevLibrary({
            reason: 'The component library is in development builds only.',
          }),
        ),
})
