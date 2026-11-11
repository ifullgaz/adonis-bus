import type { ApplicationService } from '@adonisjs/core/types'
import { BusManager } from '@boringnode/bus'
import type { BusConfig, KnownTransports } from '../src/types/types.js'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    bus: BusManager<KnownTransports>
  }
}

export default class BusProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton('bus', async () => {
      const config = this.app.config.get('bus') as BusConfig<KnownTransports>
      if (!config?.transports) {
        return new BusManager(config)
      }
      return new BusManager({
        ...config,
        default: config.default || 'redis',
      })
    })
  }

  async shutdown() {
    const bus = await this.app.container.make('bus')
    await bus.disconnect()
  }
}
