import app from '@adonisjs/core/services/app'
import { RuntimeException } from '@adonisjs/core/exceptions'
import type { BusConfig, KnownTransports } from './types/types.js'

export function busPrefixedKey(key: string, connectionName?: string) {
  const config = app.config.get('bus') as BusConfig<KnownTransports>
  if (!config) {
    throw new RuntimeException('Bus config is not defined')
  }
  const name = connectionName ?? (config.default ? String(config.default) : undefined)
  if (!name) {
    throw new RuntimeException('Bus default transport is not defined')
  }
  const transportConfig = config.transports[name]
  if (!transportConfig) {
    throw new RuntimeException(`Bus transport "${name}" is not defined`)
  }
  const keyPrefix = transportConfig.keyPrefix
  return keyPrefix ? `${keyPrefix}${key}` : key
}
