import type { PageKey } from '../pageModel.js'
import { BuildingPage } from './Building.js'
import { ChroniclePage } from './Chronicle.js'
import { FolkPage } from './Folk.js'
import { FoundPage } from './Found.js'
import { LawsPage } from './Laws.js'
import { PersonPage } from './Person.js'
import type { PageProps } from './types.js'

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
