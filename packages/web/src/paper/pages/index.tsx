import type { Scene } from '../../render/scene.js'
import type { ObservatoryHandle } from '../../net/socket.js'
import type { WorldStore } from '../../state/worldStore.js'
import type { Subject } from '../../stage/index.js'
import type { PageKey } from '../pageModel.js'
import { BuildingPage } from './Building.js'
import { ChroniclePage } from './Chronicle.js'
import { FolkPage } from './Folk.js'
import { FoundPage } from './Found.js'
import { LawsPage } from './Laws.js'
import { PersonPage } from './Person.js'

export type PageProps = {
  tab: string
  subject: Subject | null
  store: WorldStore
  scene: Scene | null
  handle: ObservatoryHandle | null
  operatorToken: string | null
  /** which interior the camera is standing in, so the Inside page knows which way the door goes */
  insideId: string | null
  /** how far the town moved while nobody was looking, or `null` when it did not */
  gapTicks: number | null
  onSubject: (subject: Subject) => void
  onInside: (structureId: string | null) => void
  onView: (tick: number | null) => void
}

export function PageBody({ page, ...props }: PageProps & { page: PageKey }) {
  switch (page) {
    case 'folk':
      return <FolkPage {...props} />
    case 'chronicle':
      return <ChroniclePage {...props} />
    case 'found':
      return <FoundPage {...props} />
    case 'laws':
      return <LawsPage {...props} />
    case 'person':
      return <PersonPage {...props} />
    case 'building':
      return <BuildingPage {...props} />
  }
}
