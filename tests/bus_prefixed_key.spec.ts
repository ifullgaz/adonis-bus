import { test } from '@japa/runner'

import { busPrefixedKey } from '../src/utils.js'
import { defineConfig } from '../src/define_config.js'
import { assertRuntimeException, createRecordingTransport, withApplication } from './helpers.js'

test.group('busPrefixedKey', () => {
  test('concatenates the default transport prefix and the key', async ({ assert }) => {
    const recording = createRecordingTransport()

    await withApplication(
      {
        config: defineConfig({
          default: 'redis',
          transports: {
            redis: {
              transport: recording.factory,
              keyPrefix: 'bus:',
            },
          },
        }),
      },
      async () => {
        assert.equal(busPrefixedKey('orders'), 'bus:orders')
        assert.equal(busPrefixedKey(''), 'bus:')
        assert.equal(recording.calls, 0)
      }
    )
  })

  test('uses the named transport instead of the default', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'redis',
          transports: {
            redis: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'redis:',
            },
            mqtt: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'mqtt:',
            },
          },
        }),
      },
      async () => {
        assert.equal(busPrefixedKey('orders', 'mqtt'), 'mqtt:orders')
        assert.equal(busPrefixedKey('orders', 'redis'), 'redis:orders')
        assert.equal(busPrefixedKey('orders'), 'redis:orders')
      }
    )
  })

  test('prefixes with a named transport when no default is configured', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          transports: {
            mqtt: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'mqtt/',
            },
          },
        }),
      },
      async () => {
        assert.equal(busPrefixedKey('orders', 'mqtt'), 'mqtt/orders')
      }
    )
  })

  test('returns the key unchanged when the prefix is empty', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: '',
            },
          },
        }),
      },
      async () => {
        assert.equal(busPrefixedKey('orders'), 'orders')
      }
    )
  })

  test('returns the key unchanged when the prefix is missing at runtime', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'memory',
          transports: {
            memory: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'ignored',
            },
          },
        }),
      },
      async (app) => {
        app.config.set('bus', {
          default: 'memory',
          transports: {
            memory: {
              transport: () => {
                throw new Error('unused')
              },
            },
          },
        })

        assert.equal(busPrefixedKey('orders'), 'orders')
      }
    )
  })

  test('reads config changes made after boot', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'redis',
          transports: {
            redis: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'old:',
            },
          },
        }),
      },
      async (app) => {
        assert.equal(busPrefixedKey('orders'), 'old:orders')

        app.config.set('bus', {
          default: 'redis',
          transports: {
            redis: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'new:',
            },
          },
        })

        assert.equal(busPrefixedKey('orders'), 'new:orders')
      }
    )
  })

  test('throws when the bus config is missing', async ({ assert }) => {
    await withApplication({}, async () => {
      assertRuntimeException(
        assert,
        capture(() => busPrefixedKey('orders')),
        'Bus config is not defined'
      )
    })
  })

  test('throws when the bus config is cleared', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'redis',
          transports: {
            redis: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'bus:',
            },
          },
        }),
      },
      async (app) => {
        app.config.set('bus', undefined)

        assertRuntimeException(
          assert,
          capture(() => busPrefixedKey('orders')),
          'Bus config is not defined'
        )
      }
    )
  })

  test('throws when no default transport and no connection name are available', async ({
    assert,
  }) => {
    await withApplication(
      {
        config: defineConfig({
          transports: {
            redis: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'bus:',
            },
          },
        }),
      },
      async () => {
        assertRuntimeException(
          assert,
          capture(() => busPrefixedKey('orders')),
          'Bus default transport is not defined'
        )
      }
    )
  })

  test('treats an empty connection name as no selected transport', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'redis',
          transports: {
            redis: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'bus:',
            },
          },
        }),
      },
      async () => {
        assertRuntimeException(
          assert,
          capture(() => busPrefixedKey('orders', '')),
          'Bus default transport is not defined'
        )
      }
    )
  })

  test('throws when the default transport is an empty string', async ({ assert }) => {
    await withApplication({}, async (app) => {
      app.config.set('bus', {
        default: '',
        transports: {
          redis: { keyPrefix: 'bus:' },
        },
      })

      assertRuntimeException(
        assert,
        capture(() => busPrefixedKey('orders')),
        'Bus default transport is not defined'
      )
    })
  })

  test('throws when the selected transport is not configured', async ({ assert }) => {
    await withApplication(
      {
        config: defineConfig({
          default: 'redis',
          transports: {
            redis: {
              transport: () => {
                throw new Error('unused')
              },
              keyPrefix: 'bus:',
            },
          },
        }),
      },
      async () => {
        assertRuntimeException(
          assert,
          capture(() => busPrefixedKey('orders', 'mqtt')),
          'Bus transport "mqtt" is not defined'
        )
      }
    )
  })

  test('throws when the default name does not match a transport', async ({ assert }) => {
    await withApplication({}, async (app) => {
      app.config.set('bus', {
        default: 'missing',
        transports: {},
      })

      assertRuntimeException(
        assert,
        capture(() => busPrefixedKey('orders')),
        'Bus transport "missing" is not defined'
      )
    })
  })
})

function capture(action: () => unknown) {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected the action to throw')
}
