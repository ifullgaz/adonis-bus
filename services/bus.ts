import app from '@adonisjs/core/services/app'
import type { BusManager } from '@boringnode/bus'
import type { KnownTransports } from '../src/types/types.js'

let bus: BusManager<KnownTransports>

await app.booted(async () => {
  bus = await app.container.make('bus')
})

export { bus as default }
