import type { BusConfig, KnownTransports } from './types/types.js'

export function defineConfig<T extends KnownTransports>(config: BusConfig<T>): BusConfig<T> {
  return config
}
