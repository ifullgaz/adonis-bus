import { IgnitorFactory } from '@adonisjs/core/factories'
import { type Assert } from '@japa/assert'
import { RuntimeException } from '@adonisjs/core/exceptions'
import { type ApplicationService } from '@adonisjs/core/types'
import {
  type Serializable,
  type SubscribeHandler,
  type Transport,
} from '@boringnode/bus/types/core'

import { type BusConfig, type KnownTransports } from '../src/types/types.js'

type ProviderLoader = () => Promise<unknown>

type CreateApplicationOptions<T extends KnownTransports = KnownTransports> = {
  appRoot?: URL
  config?: BusConfig<T>
  providers?: ProviderLoader[]
  rcFileContents?: Record<string, unknown>
}

/**
 * Boots an in-memory AdonisJS app. Pass `config` to install `config/bus`.
 * Provider modules passed in `providers` are registered after the core providers.
 */
export async function bootApplication<T extends KnownTransports>(
  options: CreateApplicationOptions<T> = {}
) {
  const app = createApplication(options)
  await app.init()
  await app.boot()
  return app
}

/**
 * Creates an application without booting it. `setApp` has already run, so
 * imports that touch the global app service see this instance.
 */
export function createApplication<T extends KnownTransports>(
  options: CreateApplicationOptions<T> = {}
) {
  const factory = new IgnitorFactory().withCoreProviders().withCoreConfig()
  const rcFileContents: Record<string, unknown> = {
    ...options.rcFileContents,
    providers: options.providers ?? [],
  }

  factory.merge({ rcFileContents })
  if (options.config) {
    factory.merge({ config: { bus: options.config } })
  }

  return factory.create(options.appRoot ?? new URL('./', import.meta.url)).createApp('web')
}

export async function withApplication<T extends KnownTransports>(
  options: CreateApplicationOptions<T>,
  run: (app: ApplicationService) => Promise<void>
) {
  const app = await bootApplication(options)
  try {
    await run(app)
  } finally {
    await app.terminate()
  }
}

export function assertRuntimeException(assert: Assert, error: unknown, message: string) {
  assert.instanceOf(error, RuntimeException)
  assert.equal((error as { message: string }).message, message)
}

/**
 * Transport that records publish, subscribe, and disconnect calls.
 * `failTimes` makes the first N publish calls throw so retry behavior can be observed.
 */
export class RecordingTransport implements Transport {
  id = ''
  attempts = 0
  failTimes = 0
  disconnects = 0
  subscribed: string[] = []
  published: Array<{ channel: string; message: Serializable }> = []

  setId(id: string) {
    this.id = id
    return this
  }

  onReconnect() {}

  async publish(channel: string, message: Serializable) {
    this.attempts++
    if (this.attempts <= this.failTimes) {
      throw new Error('publish failed')
    }
    this.published.push({ channel, message })
  }

  async subscribe<T extends Serializable>(channel: string, _handler: SubscribeHandler<T>) {
    this.subscribed.push(channel)
  }

  async unsubscribe() {}

  async disconnect() {
    this.disconnects++
  }
}

export function createRecordingTransport() {
  const transport = new RecordingTransport()
  let calls = 0
  const factory = () => {
    calls++
    return transport
  }

  return {
    transport,
    factory,
    get calls() {
      return calls
    },
  }
}
