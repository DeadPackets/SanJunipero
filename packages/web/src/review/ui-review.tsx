import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { DEFAULT_CONFIG, type AssetRecord } from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import { createWorldStore } from '../state/worldStore.js'
import { characterArt } from '../render/textures.js'
import { GameIcon } from '../paper/game/shared.js'
import { DayBar } from '../stage/DayBar.js'
import { WeatherIcon } from '../stage/WeatherIcon.js'
import { PixelGlyph } from '../stage/PixelGlyph.js'
import { WEATHER_GLYPH } from '../ui/townStats.js'
import { InteriorHUD } from '../stage/InteriorHUD.js'
import { KeyMap } from '../stage/KeyMap.js'
import { buildStructure } from '../render/three/structures.js'
import { syncBuildingFire } from '../render/three/buildingFire.js'
import { disposeGroup } from '../render/three/dispose.js'
import '@fontsource/silkscreen/latin-400.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/fraunces/latin-500.css'
import '@fontsource/fraunces/latin-700.css'
import '../ui/chrome.css'
import '../paper/game/game.css'
import '../ui/corner-controls.css'
import '../ui/interiors.css'
import '../ui/almanac.css'
import '../ui/harmony.css'
import './ui-review.css'

type Fixture = { state: WorldState; assets: AssetRecord[]; config: typeof DEFAULT_CONFIG }
const data = (await fetch('/review-town.json').then((r): Promise<unknown> => r.json())) as Fixture
const store = createWorldStore()
const sample = structuredClone(data.state)
sample.tick = 9 * 1440 + 18 * 60 + 30
sample.weather.kind = 'storm'
const home = Object.values(sample.structures).find((s) => s.kind === 'house')!
for (const [i, id] of ['nadia', 'yusuf', 'amara'].entries()) {
  const person = sample.agents[id]
  if (person) {
    person.insideId = home.id
    person.asleep = i === 0
    person.activity =
      i === 2 ? { verb: 'craft', ticksRemaining: 8, params: { kind: 'plank' } } : null
  }
}
store.applyServer({
  t: 'snapshot',
  state: sample,
  config: data.config,
  tick: sample.tick,
  seq: 0,
  laws: {},
  live: true,
})
store.applyServer({ t: 'assets', records: data.assets })
store.setDressed()
const noop = () => undefined
const absent = () => null

function Resident({ id, sleep = false }: { id: string; sleep?: boolean }) {
  const art = characterArt(data.assets, id)
  const cell = art.manifest?.cells[sleep ? 'sleep-se' : 'idle-se'] ?? art.manifest?.cells['idle-se']
  if (!cell || !art.size || !art.manifest)
    return <span className="review-person-missing">{id}</span>
  const scale = 126 / art.manifest.figureH
  return (
    <span
      className="review-person"
      role="img"
      aria-label={data.state.agents[id]?.name ?? id}
      style={{
        width: cell.w * scale,
        height: cell.h * scale,
        backgroundImage: `url(${art.url})`,
        backgroundSize: `${art.size.w * scale}px ${art.size.h * scale}px`,
        backgroundPosition: `${-cell.x * scale}px ${-cell.y * scale}px`,
      }}
    />
  )
}

function StateSample({ state, treatment }: { state: string; treatment: string }) {
  const icon = state === 'Asleep' ? 'moon' : state === 'Thinking' ? 'note' : 'hammer'
  const id = state === 'Asleep' ? 'nadia' : state === 'Thinking' ? 'yusuf' : 'amara'
  return (
    <div className="state-sample" data-state={state} data-treatment={treatment}>
      <div className="state-marker">
        {treatment === 'current' ? (
          state === 'Asleep' ? (
            <i className="old-sleep" />
          ) : state === 'Thinking' ? (
            <span className="old-caret">
              <i />
              <i />
              <i />
            </span>
          ) : null
        ) : (
          <span className="resident-token">
            {state === 'Thinking' ? (
              <span className="control-icon control-icon-thoughts" aria-hidden="true" />
            ) : (
              <GameIcon kind={icon} />
            )}
            {treatment === 'labels' && <span>{state === 'Working' ? 'Crafting' : state}</span>}
            {state === 'Thinking' && (
              <span className="thinking-dots">
                <i />
                <i />
                <i />
              </span>
            )}
          </span>
        )}
      </div>
      <Resident id={id} sleep={state === 'Asleep'} />
      {state === 'Working' && (
        <span className={treatment === 'current' ? 'old-work' : 'work-caption'}>
          {treatment !== 'labels' && 'Crafting'}
          <i />
        </span>
      )}
      <span className="resident-name">{data.state.agents[id]?.name}</span>
    </div>
  )
}

function FireScene() {
  const host = useRef<HTMLDivElement>(null)
  const [burning, setBurning] = useState(true)
  const [night, setNight] = useState(false)
  const [paused, setPaused] = useState(false)
  const values = useRef({ burning, night, paused })
  useEffect(() => {
    values.current = { burning, night, paused }
  }, [burning, night, paused])
  useEffect(() => {
    const el = host.current!
    const scene = new THREE.Scene()
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    el.append(renderer.domElement)
    const camera = new THREE.OrthographicCamera()
    camera.position.set(13, 12, 13)
    camera.lookAt(1.5, 1.8, 1.5)
    const structure: Structure = {
      ...home,
      id: 'review-fire',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      burning: true,
      owner: 'amara',
    }
    const house = buildStructure(structure, data.config)
    scene.add(house)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: '#9baf7f', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    ground.position.y = -0.02
    scene.add(ground)
    const sun = new THREE.DirectionalLight('#fff1d4', 3)
    sun.position.set(-4, 9, 6)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.normalBias = 0.04
    scene.add(sun)
    const ambient = new THREE.HemisphereLight('#e4eef5', '#737657', 2)
    scene.add(ambient)
    let seconds = 0,
      last = performance.now(),
      raf = 0
    let visible = true
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight
      renderer.setSize(w, h)
      camera.left = (-4.8 * w) / h
      camera.right = (4.8 * w) / h
      camera.top = 4.8
      camera.bottom = -4.8
      camera.near = 0.1
      camera.far = 100
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry!.isIntersecting
    })
    intersection.observe(el)
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dt = (now - last) / 1000
      if (dt < 1 / 30) return
      last = now
      if (!visible || document.hidden) return
      if (!values.current.paused && !motion.matches) seconds += Math.min(dt, 0.1)
      structure.burning = values.current.burning
      syncBuildingFire(house, structure, seconds)
      scene.background = new THREE.Color(values.current.night ? '#172931' : '#b7c4a6')
      sun.intensity = values.current.night ? 0.3 : 3
      ambient.intensity = values.current.night ? 0.6 : 2
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      intersection.disconnect()
      disposeGroup(house)
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      sun.shadow.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])
  return (
    <>
      <div
        ref={host}
        className="fire-scene"
        aria-label="Actual town house with the revised burning effect"
      />
      <div className="review-actions">
        <button
          aria-pressed={burning}
          onClick={() => {
            setBurning((v) => !v)
          }}
        >
          {burning ? 'Extinguish fire' : 'Ignite example'}
        </button>
        <button
          aria-pressed={night}
          onClick={() => {
            setNight((v) => !v)
          }}
        >
          {night ? 'Show daylight' : 'Show night'}
        </button>
        <button
          aria-pressed={paused}
          onClick={() => {
            setPaused((v) => !v)
          }}
        >
          {paused ? 'Resume effect' : 'Pause effect'}
        </button>
        <span>Isolated example. No town events are changed.</span>
      </div>
    </>
  )
}

function Review() {
  const [section, setSection] = useState('Components')
  const [help, setHelp] = useState(false)
  const [notice, setNotice] = useState('')
  const [treatment, setTreatment] = useState('labels')
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
    }
  }, [])
  const sections = ['Components', 'Weather', 'Resident states', 'Building fire']
  return (
    <div className="review-shell app">
      <header className="review-header">
        <a href="/ui-review.html" className="review-brand">
          <GameIcon kind="note" />
          <span>
            San Junipero <b>Finishing the details</b>
          </span>
        </a>
        <a className="review-town-link" href="/" target="_blank" rel="noreferrer">
          Explore updated town <span aria-hidden="true">↗</span>
        </a>
      </header>
      <div className="review-intro">
        <h1>One town. One visual language.</h1>
        <p>The familiar Journal palette, carried through the controls and moments around it.</p>
        <span className="review-sample-note">
          Component samples use staged states. AI minds remain off.
        </span>
      </div>
      <nav className="review-nav" aria-label="Review sections">
        {sections.map((name, i) => (
          <button
            key={name}
            aria-current={section === name ? 'page' : undefined}
            onClick={() => {
              setSection(name)
            }}
          >
            <GameIcon kind={['note', 'leaf', 'folk', 'land'][i]!} />
            {name}
          </button>
        ))}
      </nav>
      <main>
        {section === 'Components' && (
          <>
            <section className="review-section">
              <div className="review-section-title">
                <h2>The almanac</h2>
                <p>Try its light / dark switch. Weather uses the new pixel artwork.</p>
              </div>
              <div className="review-frame app">
                <DayBar
                  store={store}
                  link="online"
                  handle={null}
                  onAt={noop}
                  onWatch={noop}
                  onLive={noop}
                  autoCut={false}
                  handbackAt={absent}
                />
              </div>
            </section>
            <section className="review-section">
              <div className="review-section-title">
                <h2>Back to the town</h2>
                <p>The same paper, edges and press feedback as the Journal.</p>
              </div>
              <div className="review-control-table">
                <div>
                  <span>Replay navigation</span>
                  <button
                    className="stage-live"
                    onClick={() => {
                      setNotice('Return to now keeps its existing live-view action in the town.')
                    }}
                  >
                    Return to now <span aria-hidden="true">→</span>
                  </button>
                </div>
                <div>
                  <span>Room navigation</span>
                  <button
                    className="stage-exit"
                    onClick={() => {
                      setNotice('Back to town keeps the current camera position.')
                    }}
                  >
                    Back to town
                  </button>
                  <button
                    className="room-door review-button"
                    aria-pressed="false"
                    onClick={() => {
                      setNotice('The real room opens when this is used on a building.')
                    }}
                  >
                    Look inside
                  </button>
                </div>
                <div>
                  <span>Person actions</span>
                  <div className="stage-ring-arms review-ring">
                    {['Follow', 'Story', 'Bonds', 'Home'].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setNotice(`${s} remains connected to the selected resident in the town.`)
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span>Help & shortcuts</span>
                  <button
                    className="review-button"
                    onClick={() => {
                      setHelp(true)
                    }}
                  >
                    <GameIcon kind="compass" />
                    Open keyboard help
                  </button>
                </div>
              </div>
              <p role="status" className="review-notice">
                {notice ||
                  'These samples demonstrate styling. Use “Explore updated town” for real navigation.'}
              </p>
            </section>
            <section className="review-section">
              <div className="review-section-title">
                <h2>Replay & reflection</h2>
                <p>Readable paper surfaces for recorded moments and secondary records.</p>
              </div>
              <div className="review-records">
                <article className="replay-card" data-up="yes">
                  <p className="replay-card-when">Day 9 · 18:30 · Example</p>
                  <h3 className="replay-card-title">An evening at the fire</h3>
                  <p className="replay-card-cast">Amara & Yusuf</p>
                  <p className="replay-card-prose">
                    A recorded moment stays distinct from what is happening now.
                  </p>
                </article>
                <div className="sj-paper">
                  <article className="night-card">
                    <h3 className="night-who">Night watch</h3>
                    <p className="night-said">A resident’s recorded reflection appears here.</p>
                    <p className="night-dreamt">
                      Dreams remain separate from things that happened.
                    </p>
                  </article>
                </div>
              </div>
            </section>
            <section className="review-section">
              <div className="review-section-title">
                <h2>Inside a home</h2>
                <p>The real interior toolbar. Open Belongings to inspect its updated panel.</p>
              </div>
              <div className="review-room">
                <InteriorHUD
                  store={store}
                  id={home.id}
                  onExit={() => {
                    setNotice('This is a staged interior toolbar.')
                  }}
                  onPerson={(id) => {
                    setNotice(`${sample.agents[id]?.name}: profile action retained.`)
                  }}
                />
              </div>
            </section>
            <section className="review-section">
              <div className="review-section-title">
                <h2>The small details</h2>
                <p>Secondary surfaces now use the same palette, with each status still distinct.</p>
              </div>
              <div className="review-details">
                <div>
                  <h3>Names & notices</h3>
                  <span className="stage-plate">Amara</span>
                  <span className="review-map-label">Amara's house</span>
                  <span className="control-tip">Town sound</span>
                  <span className="sound-cue">Rain on the rooftops</span>
                  <div className="fps-overlay">
                    <span className="fps-avg">Frame time</span> 16 ms
                  </div>
                </div>
                <div className="sj-paper" data-book="laws">
                  <h3>Extended records</h3>
                  <div className="laws-notice">The town’s agreements live here.</div>
                  <div className="sheet-note operator">
                    Operator tools stay separate from the town.
                  </div>
                  <button
                    className="record-range-pick"
                    aria-pressed="true"
                    onClick={() => {
                      setNotice('Selected range sample.')
                    }}
                  >
                    This day
                  </button>
                  <button
                    className="record-range-pick"
                    aria-pressed="false"
                    onClick={() => {
                      setNotice('Unselected range sample.')
                    }}
                  >
                    This week
                  </button>
                  <div className="discovery-utterance">A recorded discovery, in its own words.</div>
                </div>
                <div className="review-bubble-sample">
                  <h3>Speech & thought</h3>
                  <div
                    className="pixel-balloon"
                    style={
                      {
                        '--tint': '#f7d9c9',
                        '--tint-ink': '#884b34',
                        '--tail-x': '28px',
                      } as React.CSSProperties
                    }
                  >
                    <span className="pixel-speaker">Amara</span>
                    <p>
                      <span>Shall we sit by the fire?</span>
                    </p>
                  </div>
                  <div
                    className="pixel-balloon"
                    data-kind="thought"
                    style={{ '--tail-x': '28px' } as React.CSSProperties}
                  >
                    <span className="pixel-speaker">Amara</span>
                    <p>
                      <span>A quiet moment would be nice.</span>
                    </p>
                  </div>
                </div>
              </div>
            </section>
            <section className="review-section">
              <h2>Scan coverage</h2>
              <div className="review-coverage">
                {[
                  'Replay navigation & titles',
                  'Selected-person actions & nameplates',
                  'Help, keycaps & performance panel',
                  'Room controls & belongings',
                  'Extended Folk, Chronicle & Rule records',
                  'Selected states & keyboard focus',
                  'Light & dark almanac',
                  'Speech / thought distinction',
                ].map((s) => (
                  <span key={s}>
                    <GameIcon kind="rule" />
                    {s}
                  </span>
                ))}
              </div>
              <p className="review-footnote">
                Character colors and the four Journal category colors are preserved. Dark
                relationship plots retain the contrast their drawn labels need.
              </p>
            </section>
          </>
        )}
        {section === 'Weather' && (
          <section className="review-section">
            <div className="review-section-title">
              <h2>A small forecast, easier to read</h2>
              <p>
                Distinct silhouettes, muted blue rain and a clear gold lightning bolt. Flat raster
                pixels, no emoji.
              </p>
            </div>
            <div className="weather-comparison">
              <div className="weather-comparison-head">
                <span>Weather</span>
                <span>Previous 8 × 8</span>
                <span>Updated 24 × 24</span>
                <span>On the night almanac</span>
              </div>
              {['sunny', 'cloudy', 'rain', 'storm', 'snow'].map((kind) => (
                <div className="weather-comparison-row" key={kind}>
                  <strong>{kind}</strong>
                  <PixelGlyph className="old-weather" pixels={WEATHER_GLYPH[kind]!.pixels} />
                  <WeatherIcon kind={kind} />
                  <span className="weather-night">
                    <WeatherIcon kind={kind} />
                    <span>{kind}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="review-footnote">
              The text forecast remains beside the icon. Weather is never communicated by color
              alone.
            </p>
          </section>
        )}
        {section === 'Resident states' && (
          <section className="review-section">
            <div className="review-section-title">
              <h2>What is on someone’s mind?</h2>
              <p>
                B is approved for the town. The previous indicators and option A remain here for
                comparison.
              </p>
            </div>
            <div className="review-choice">
              <button
                aria-pressed={treatment === 'tokens'}
                onClick={() => {
                  setTreatment('tokens')
                }}
              >
                A · Little tokens
              </button>
              <button
                aria-pressed={treatment === 'labels'}
                onClick={() => {
                  setTreatment('labels')
                }}
              >
                B · Tokens + words
              </button>
            </div>
            <div className="state-head">
              <span>Previous design</span>
              <span>{treatment === 'tokens' ? 'A · Little tokens' : 'B · Tokens + words'}</span>
            </div>
            {['Asleep', 'Thinking', 'Working'].map((s) => (
              <div className="state-compare" key={s}>
                <h3>{s}</h3>
                <StateSample state={s} treatment="current" />
                <StateSample state={s} treatment={treatment} />
              </div>
            ))}
            <div className="state-explanation">
              <h3>
                {treatment === 'tokens'
                  ? 'A keeps the town quieter.'
                  : 'B makes each state explicit.'}
              </h3>
              <p>
                Moon for sleep, a thought cloud and three dots for thinking, a hammer for work. The
                actual work verb stays visible. A progress line appears only when the recorded
                action supports it.
              </p>
              <p>
                Thinking means a live AI request, not a mood or an invented thought. It stays absent
                in replay. Urgent health indicators keep priority.
              </p>
            </div>
            <div className="review-indoor-note">
              <GameIcon kind="land" />
              <p>
                <strong>Inside and outside:</strong> the approved tokens follow residents in both
                views. Thinking appears only during a live AI request for someone in focus.
              </p>
            </div>
            <p className="review-footnote">
              This comparison uses a held pose. B is integrated into the local town. Motion stops
              with reduced-motion preference.
            </p>
          </section>
        )}
        {section === 'Building fire' && (
          <section className="review-section">
            <div className="review-section-title">
              <h2>A fire you can actually see</h2>
              <p>
                The town’s real house mesh, with flames above the roof and a rising smoke plume.
              </p>
            </div>
            <FireScene />
            <p className="review-footnote">
              The old flames were small and buried inside the roof. The new effect follows the
              building’s footprint and disappears when the recorded fire ends. No extra point lights
              or postprocessing.
            </p>
          </section>
        )}
      </main>
      <footer className="review-footer">
        <span>Local design review · Warm paper / flat icons</span>
        <span>Layout and simulation rules unchanged</span>
      </footer>
      <KeyMap open={help} onOpenChange={setHelp} />
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Review />)
