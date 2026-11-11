import { test } from '@japa/runner'
import { Bus, BusManager } from '@boringnode/bus'
import { memory } from '@boringnode/bus/transports/memory'

import { defineConfig } from '../src/define_config.js'
import { createApplication } from './helpers.js'

test.group('bus service', () => {
  test('resolves the container bus when the application boots', async ({ assert }) => {
    const app = createApplication({
      providers: [() => import('../providers/provider.js')],
      config: defineConfig({
        default: 'memory',
        transports: {
          memory: { transport: memory(), keyPrefix: 'svc:' },
        },
      }),
    })

    await app.init()
    const service = await import('../services/bus.js')

    assert.isUndefined(service.default)

    await app.boot()

    try {
      assert.instanceOf(service.default, BusManager)
      assert.strictEqual(service.default, await app.container.make('bus'))

      const peer = new Bus(memory()())
      const received: unknown[] = []
      try {
        await peer.subscribe('orders', (message) => {
          received.push(message)
        })
        assert.isTrue(await service.default.publish('orders', { id: 4 }))
        assert.deepEqual(received, [{ id: 4 }])
      } finally {
        await peer.disconnect()
      }
    } finally {
      await app.terminate()
    }
  })
})
