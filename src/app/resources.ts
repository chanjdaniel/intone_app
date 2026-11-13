import { ManagedResource } from 'foldkit'

import {
  type ClipEditorResourceService,
  levelResources,
} from './level/resources'
import {
  type TakeResourceServices,
  managedResources as takeResources,
} from './take/resources'

// Every resource the app holds while its Model needs it: the take's
// tracker and microphone (./take/resources.ts), and the line editor's
// clip Worker (./level/resources.ts).

export const managedResources = ManagedResource.aggregate(
  takeResources,
  levelResources,
)

export type AppResourceServices =
  | TakeResourceServices
  | ClipEditorResourceService
