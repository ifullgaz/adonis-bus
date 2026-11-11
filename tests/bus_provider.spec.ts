import { test } from '@japa/runner'
import { Bus, BusManager } from '@boringnode/bus'
import { memory } from '@boringnode/bus/transports/memory'

import { defineConfig } from '../src/define_config.js'
import { busPrefixedKey } from '../src/utils.js'
import BusProvider from '../providers/provider.js'
import { createRecordingTransport, withApplication } from './helpers.js'

test.group('BusProvider', () => {
  test('creates the default transport lazily and caches the manager', async ({ assert }) => {
    const redis = createRecordingTransport()
    const memoryTransport = createRecordingTransport()

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            redis: { transport: redis.factory, keyPrefix: 'redis:' },
            memory: { transport: memoryTransport.factory, keyPrefix: 'memory:' },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()

        assert.equal(redis.calls, 0)
        assert.equal(memoryTransport.calls, 0)

        const first = await app.container.make('bus')
        const second = await app.container.make('bus')

        assert.instanceOf(first, BusManager)
        assert.strictEqual(first, second)
        assert.equal(memoryTransport.calls, 0)
        assert.equal(redis.calls, 0)

        const bus = first.use()
        assert.instanceOf(bus, Bus)
        assert.strictEqual(first.use(), bus)
        assert.equal(memoryTransport.calls, 1)
        assert.equal(redis.calls, 0)
        await provider.shutdown()
      }
    )
  })

  test('falls back to the redis transport when default is omitted', async ({ assert }) => {
    const redis = createRecordingTransport()
    const other = createRecordingTransport()

    await withApplication(
      {
        config: defineConfig({
          transports: {
            redis: { transport: redis.factory, keyPrefix: 'redis:' },
            memory: { transport: other.factory, keyPrefix: 'memory:' },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')

        assert.equal(redis.calls, 0)
        await bus.use()
        assert.equal(redis.calls, 1)
        assert.equal(other.calls, 0)
        await provider.shutdown()
      }
    )
  })

  test('falls back to redis when the default name is empty', async ({ assert }) => {
    const redis = createRecordingTransport()

    await withApplication({}, async (app) => {
      app.config.set('bus', {
        default: '',
        transports: {
          redis: { transport: redis.factory, keyPrefix: 'redis:' },
        },
      })

      const provider = new BusProvider(app)
      provider.register()
      const bus = await app.container.make('bus')

      assert.equal(redis.calls, 0)
      await bus.use()
      assert.equal(redis.calls, 1)
      await provider.shutdown()
    })
  })

  test('registers the bus when the provider is loaded from the rc file', async ({ assert }) => {
    const recording = createRecordingTransport()

    await withApplication(
      {
        providers: [() => import('../providers/provider.js')],
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: { transport: recording.factory, keyPrefix: '' },
          },
        }),
      },
      async (app) => {
        const bus = await app.container.make('bus')
        assert.instanceOf(bus, BusManager)
        assert.equal(recording.calls, 0)
        assert.instanceOf(bus.use(), Bus)
        assert.equal(recording.calls, 1)
      }
    )
  })

  test('forwards retry queue options to the bus', async ({ assert }) => {
    const recording = createRecordingTransport()

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: recording.factory,
              keyPrefix: '',
              retryQueue: {
                enabled: false,
                removeDuplicates: false,
                maxSize: 4,
                retryInterval: '100ms',
              },
            },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')

        assert.deepEqual(bus.use().getRetryQueue().getOptions(), {
          enabled: false,
          removeDuplicates: false,
          maxSize: 4,
        })
        await provider.shutdown()
      }
    )
  })

  test('uses the bus defaults when retry queue options are omitted', async ({ assert }) => {
    const recording = createRecordingTransport()
    recording.transport.failTimes = 1

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: { transport: recording.factory, keyPrefix: '' },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')
        const published = await bus.publish('orders', 'hello')

        assert.isFalse(published)
        assert.equal(bus.use().getRetryQueue().size(), 1)
        assert.deepEqual(bus.use().getRetryQueue().getOptions(), {
          enabled: true,
          maxSize: null,
          removeDuplicates: true,
        })
        await provider.shutdown()
      }
    )
  })

  test('does not queue a publish when the retry queue is disabled', async ({ assert }) => {
    const recording = createRecordingTransport()
    recording.transport.failTimes = 1

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: recording.factory,
              keyPrefix: '',
              retryQueue: { enabled: false },
            },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')
        const published = await bus.publish('orders', 'hello')

        assert.isFalse(published)
        assert.equal(bus.use().getRetryQueue().size(), 0)
        assert.equal(recording.transport.attempts, 1)
        await provider.shutdown()
      }
    )
  })

  test('drops the oldest queued message when maxSize is reached', async ({ assert }) => {
    const recording = createRecordingTransport()
    recording.transport.failTimes = 5

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: recording.factory,
              keyPrefix: '',
              retryQueue: { enabled: true, removeDuplicates: false, maxSize: 1 },
            },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')

        await bus.publish('first', 'one')
        await bus.publish('second', 'two')
        assert.equal(bus.use().getRetryQueue().size(), 1)

        recording.transport.failTimes = 0
        await bus.use().processErrorRetryQueue()

        assert.equal(bus.use().getRetryQueue().size(), 0)
        assert.deepEqual(recording.transport.published, [{ channel: 'second', message: 'two' }])
        await provider.shutdown()
      }
    )
  })

  test('keeps one copy of a queued message when duplicates are removed', async ({ assert }) => {
    const recording = createRecordingTransport()
    recording.transport.failTimes = 5

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: recording.factory,
              keyPrefix: '',
              retryQueue: { enabled: true, removeDuplicates: true },
            },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')

        const first = await bus.publish('orders', { id: 1 })
        const duplicate = await bus.publish('orders', { id: 1 })
        const other = await bus.publish('orders', { id: 2 })

        assert.isFalse(first)
        assert.isFalse(duplicate)
        assert.isFalse(other)
        assert.equal(bus.use().getRetryQueue().size(), 2)
        await provider.shutdown()
      }
    )
  })

  test('retries a failed publish on the configured interval', async ({ assert }) => {
    const recording = createRecordingTransport()
    recording.transport.failTimes = 1

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: recording.factory,
              keyPrefix: '',
              retryQueue: { enabled: true, retryInterval: '20ms' },
            },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        try {
          const bus = await app.container.make('bus')
          const published = await bus.publish('orders', { id: 7 })

          assert.isFalse(published)
          await waitUntil(() => {
            return (
              recording.transport.published.length === 1 && bus.use().getRetryQueue().size() === 0
            )
          })
          assert.equal(recording.transport.attempts, 2)
          assert.deepEqual(recording.transport.published, [
            { channel: 'orders', message: { id: 7 } },
          ])
        } finally {
          await provider.shutdown()
        }
      }
    )
  }).timeout(5000)

  test('publishes the channel it is given and leaves prefixing to busPrefixedKey', async ({
    assert,
  }) => {
    const recording = createRecordingTransport()

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: { transport: recording.factory, keyPrefix: 'bus:' },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')
        const channel = busPrefixedKey('orders')

        assert.equal(channel, 'bus:orders')
        const published = await bus.publish(channel, { id: 1 })

        assert.isTrue(published)
        assert.deepEqual(recording.transport.published, [
          { channel: 'bus:orders', message: { id: 1 } },
        ])
        await bus.publish('orders', 'raw')
        assert.equal(recording.transport.published[1].channel, 'orders')
        await provider.shutdown()
      }
    )
  })

  test('exchanges messages with another bus on the memory transport', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: { transport: memory(), keyPrefix: '' },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')
        const peer = new Bus(memory()())
        const receivedByPeer: unknown[] = []
        const receivedByBus: unknown[] = []

        try {
          await peer.subscribe('orders', (message) => {
            receivedByPeer.push(message)
          })
          await bus.subscribe('orders', (message) => {
            receivedByBus.push(message)
          })

          assert.isTrue(await bus.publish('orders', { id: 1 }))
          assert.deepEqual(receivedByPeer, [{ id: 1 }])
          assert.deepEqual(receivedByBus, [])

          assert.isTrue(await peer.publish('orders', 'from-peer'))
          assert.deepEqual(receivedByBus, ['from-peer'])
        } finally {
          await provider.shutdown()
          await peer.disconnect()
        }

        assert.deepEqual(receivedByBus, ['from-peer'])
        await peer.publish('orders', 'after-shutdown')
        assert.deepEqual(receivedByBus, ['from-peer'])
      }
    )
  })

  test('disconnects the resolved bus on shutdown and returns that same instance', async ({
    assert,
  }) => {
    const recording = createRecordingTransport()

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: { transport: recording.factory, keyPrefix: '' },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')

        await bus.subscribe('orders', () => {})
        await provider.shutdown()

        assert.equal(recording.transport.disconnects, 1)
        assert.strictEqual(await app.container.make('bus'), bus)

        await provider.shutdown()
        assert.equal(recording.transport.disconnects, 1)
        assert.equal(recording.calls, 1)
      }
    )
  })

  test('does not open a transport when shutdown runs before the first use', async ({ assert }) => {
    const recording = createRecordingTransport()

    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: { transport: recording.factory, keyPrefix: '' },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()

        assert.equal(recording.calls, 0)
        await provider.shutdown()

        assert.equal(recording.calls, 0)
        assert.equal(recording.transport.disconnects, 0)
        assert.instanceOf(await app.container.make('bus'), BusManager)
      }
    )
  })

  test('rejects resolution when the bus config is missing', async ({ assert }) => {
    await withApplication({}, async (app) => {
      const provider = new BusProvider(app)
      provider.register()

      await assert.rejects(() => app.container.make('bus'), /transports/)
      await assert.rejects(() => provider.shutdown(), /transports/)
    })
  })

  test('rejects resolution when the selected transport is missing', async ({ assert }) => {
    await withApplication({}, async (app) => {
      app.config.set('bus', {
        default: 'mqtt',
        transports: {
          redis: {
            transport: () => {
              throw new Error('redis should not be selected')
            },
            keyPrefix: '',
          },
        },
      })

      const provider = new BusProvider(app)
      provider.register()
      const bus = await app.container.make('bus')

      await assert.rejects(() => bus.use(), TypeError)
    })
  })

  test('rejects resolution when the transport factory throws', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: () => {
                throw new Error('factory failed')
              },
              keyPrefix: '',
            },
          },
        }),
      },
      async (app) => {
        const provider = new BusProvider(app)
        provider.register()
        const bus = await app.container.make('bus')

        await assert.rejects(() => bus.use(), /factory failed/)
      }
    )
  })

  test('rejects shutdown when the bus binding was never registered', async ({ assert }) => {
    await withApplication({}, async (app) => {
      const provider = new BusProvider(app)

      try {
        await provider.shutdown()
        assert.fail('shutdown should reject when the bus binding is missing')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.include((error as Error).message, 'bus')
      }
    })
  })
})

async function waitUntil(predicate: () => boolean) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for the retry queue')
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
}
