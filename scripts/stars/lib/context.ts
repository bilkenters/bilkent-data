import type { StarsClient } from '../http'
import type { StateFile } from '../types'
import type { Writer } from './json'

export interface Ctx {
  client: StarsClient
  writer: Writer
  state: StateFile
  log: (msg: string) => void
  /** ISO zaman damgasi; testlerde sabitlenir */
  now: () => string
  /** tier ozeti icin kapsama sayaclari */
  coverage: Record<string, number | string>
}
