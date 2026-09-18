import icons from '../paper/game/assets/weather-icons.png'

const SKIES = ['sunny', 'cloudy', 'rain', 'storm', 'snow']

export function WeatherIcon({ kind }: { kind: string }) {
  const index = SKIES.indexOf(kind)
  return (
    <span
      className="weather-icon almanac-sky"
      aria-hidden="true"
      style={{
        backgroundImage: `url(${icons})`,
        backgroundPosition: `${((index < 0 ? 5 : index) * 100) / 5}% 0`,
      }}
    />
  )
}
