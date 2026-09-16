import { GameFolk, GamePerson } from '../game/Folk.js'
import { GameChronicle } from '../game/Chronicle.js'
import { GameLand, GameBuilding } from '../game/Land.js'
import { GameRule } from '../game/Rule.js'
import { useSyncExternalStore } from 'react'
import type { PageKey } from '../pageModel.js'
import { ChroniclePage } from './Chronicle.js'
import { FolkPage } from './Folk.js'
import { LawsPage } from './Laws.js'
import { PersonPage } from './Person.js'
import type { PageProps } from './types.js'

export function PageBody({ page, ...props }: PageProps & { page: PageKey }) {
  const mode = useSyncExternalStore(props.store.subscribe, props.store.getMode, props.store.getMode)
  if (
    !mode.live &&
    ((page === 'chronicle' && props.tab === 'Record') ||
      (page === 'person' && ['Story', 'Bonds', 'Ledger'].includes(props.tab)) ||
      (page === 'folk' && ['Bonds', 'Families', 'Customs'].includes(props.tab)))
  )
    return (
      <p className="sj-footnote">
        This extended record describes the present town.{' '}
        <button className="sj-link" type="button" onClick={props.onLive}>
          Return to live to read it →
        </button>
      </p>
    )
  switch (page) {
    case 'folk':
      return ['Bonds', 'Families', 'Customs'].includes(props.tab) ? (
        <FolkPage {...props} />
      ) : (
        <GameFolk {...props} />
      )
    case 'chronicle':
      return props.tab === 'Record' ? <ChroniclePage {...props} /> : <GameChronicle {...props} />
    case 'found':
      return <GameLand {...props} />
    case 'laws':
      return props.tab === 'Admin' ? <LawsPage {...props} /> : <GameRule {...props} />
    case 'person':
      return ['Story', 'Bonds', 'Ledger'].includes(props.tab) ? (
        <PersonPage {...props} />
      ) : (
        <GamePerson key={props.subject?.id} {...props} />
      )
    case 'building':
      return <GameBuilding {...props} />
  }
}
