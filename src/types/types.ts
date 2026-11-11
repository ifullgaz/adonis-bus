import type { Bus } from '@boringnode/bus'
import type {
  TransportFactory,
  RetryQueueOptions,
  Serializable,
  SubscribeHandler,
} from '@boringnode/bus/types/main'

export { TransportFactory, RetryQueueOptions, Serializable, SubscribeHandler }
export interface TransportConfig {
  transport: TransportFactory
  keyPrefix: string
  retryQueue?: RetryQueueOptions
}

export type KnownTransports = Record<string, TransportConfig>

export interface BusConfig<T extends KnownTransports> {
  default?: keyof T
  transports: T
}

export interface BusContract<Transports extends KnownTransports> {
  use<Name extends keyof Transports>(name?: Name): Bus
  publish(channel: string, message: Serializable): Promise<boolean>
  subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>): Promise<void>
  unsubscribe(channel: string): Promise<void>
  disconnect(): Promise<void>
}
