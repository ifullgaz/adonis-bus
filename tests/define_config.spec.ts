import { test } from '@japa/runner'

import { defineConfig } from '../src/define_config.js'

test.group('defineConfig', () => {
  test('returns the same config reference', ({ assert }) => {
    const config = {
      default: 'redis' as const,
      transports: {
        redis: {
          transport: () => {
            throw new Error('transport should not be created while defining config')
          },
          keyPrefix: 'bus:',
          retryQueue: {
            enabled: true,
            removeDuplicates: false,
            maxSize: 3,
            retryInterval: '100ms' as const,
          },
        },
        memory: {
          transport: () => {
            throw new Error('transport should not be created while defining config')
          },
          keyPrefix: '',
        },
      },
    }

    const defined = defineConfig(config)

    assert.strictEqual(defined, config)
    assert.strictEqual(defined.transports, config.transports)
    assert.strictEqual(defined.transports.redis.retryQueue, config.transports.redis.retryQueue)
    assert.equal(defined.default, 'redis')
  })

  test('keeps a config that has no default transport', ({ assert }) => {
    const config = defineConfig({
      transports: {
        redis: {
          transport: () => {
            throw new Error('unused')
          },
          keyPrefix: 'redis:',
        },
      },
    })

    assert.isUndefined(config.default)
    assert.equal(config.transports.redis.keyPrefix, 'redis:')
  })
})
