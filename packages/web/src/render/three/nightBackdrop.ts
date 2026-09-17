import {
  DataTexture,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three'

export function createNightBackdrop(scene: Scene) {
  const width = 1024,
    height = 512
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1)
    for (let x = 0; x < width; x++)
      pixels.set(
        [Math.round(61 - 50 * t), Math.round(70 - 50 * t), Math.round(95 - 53 * t), 255],
        (y * width + x) * 4,
      )
  }
  let seed = 73
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < 130; i++) {
    const x = 2 + Math.floor(random() * (width - 4))
    const y = 2 + Math.floor(random() * (height - 4))
    const brightness = 100 + Math.floor(random() * 85)
    pixels.set([brightness, brightness, Math.min(255, brightness + 12), 255], (y * width + x) * 4)
  }
  const texture = new DataTexture(pixels, width, height)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = texture.minFilter = LinearFilter
  texture.needsUpdate = true
  const material = new ShaderMaterial({
    uniforms: { sky: { value: texture }, opacity: { value: 0 }, aspect: { value: 2 } },
    vertexShader:
      'varying vec2 skyUv; void main() { skyUv = uv; gl_Position = vec4(position.xy, 0.999999, 1.0); }',
    fragmentShader:
      'uniform sampler2D sky; uniform float opacity; uniform float aspect; varying vec2 skyUv; void main() { vec2 uv = (skyUv - 0.5) * vec2(min(1.0, aspect / 2.0), min(1.0, 2.0 / aspect)) + 0.5; gl_FragColor = vec4(texture2D(sky, uv).rgb, opacity); \n#include <colorspace_fragment>\n }',
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  })
  // Far depth keeps the backdrop behind terrain, including transparent roofs with ground below.
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  mesh.name = 'Night backdrop'
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  mesh.visible = false
  scene.add(mesh)
  let lastTick: number | undefined
  let cover = 1
  return {
    update(
      tick: number,
      daylight: number,
      weather: string,
      dt: number,
      moving: boolean,
      aspect: number,
    ) {
      const seeking = lastTick === undefined || Math.abs(tick - lastTick) > 5 || !moving
      lastTick = tick
      material.uniforms.aspect!.value = aspect
      const target =
        weather === 'rain' || weather === 'storm' || weather === 'snow'
          ? 0
          : weather === 'cloudy'
            ? 0.25
            : 1
      cover += (target - cover) * (seeking ? 1 : 1 - Math.exp(-dt / 3))
      material.uniforms.opacity!.value = (1 - daylight) * cover
      mesh.visible = (1 - daylight) * cover > 0.002
    },
    destroy() {
      scene.remove(mesh)
      mesh.geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
