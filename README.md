# @ifullgaz/adonis-bus

AdonisJS v7 integration for [`@boringnode/bus`](https://github.com/boringnode/bus). The package registers one bus in the container, reads its transport and retry queue from `config/bus.ts`, and disconnects that bus when the application shuts down.

The bus publishes and subscribes to named channels. Redis and MQTT are the production transports. The memory transport is for tests in a single process. A bus does not receive the messages it publishes itself.

Requires Node.js 24 or newer and `@adonisjs/core` 7.

## Install

The package is published to GitHub Packages.

```sh
npm install @ifullgaz/adonis-bus
```

Or, using ace to configure the package immediately:

```sh
node ace add @ifullgaz/adonis-bus
```

Point the `@ifullgaz` scope at GitHub Packages in an `.npmrc` next to the application `package.json`:

```text
@ifullgaz:registry=https://npm.pkg.github.com
```

Install the client for the transport you use. `@boringnode/bus` loads `ioredis` for Redis and `mqtt` for MQTT, and both are optional peer dependencies of that package.

```sh
npm install ioredis
npm install mqtt
```

`@adonisjs/core` must already be installed. `@adonisjs/assembler` is an optional peer dependency. The configure command needs it to edit `adonisrc.ts`.

## Configure

From the application root:

```sh
node ace configure @ifullgaz/adonis-bus
```

This registers the provider in `adonisrc.ts`:

```ts
() => import('@ifullgaz/adonis-bus/provider')
```

It also creates `config/bus.ts` from the package stub. An existing file is left unchanged. Pass `--force` to overwrite it.

```ts
import { defineConfig } from '@ifullgaz/adonis-bus'
import { redis } from '@boringnode/bus/transports/redis'

export default defineConfig({
  default: 'redis',
  transports: {
    redis: {
      transport: redis({
        host: 'localhost',
        port: 6379,
      }),
      keyPrefix: 'bus:',
      retryQueue: {
        enabled: true,
        removeDuplicates: true,
        maxSize: 100,
        retryInterval: '100ms',
      },
    },
  },
})
```

`defineConfig` returns the same object. It exists so the config file is type-checked.

## What the provider starts

`BusProvider` registers a container singleton named `bus`. The singleton is created the first time it is resolved.

The provider reads `config/bus`. It opens `config.default`, or `redis` when `default` is omitted or an empty string. The factory stored on that transport is called once. Its `retryQueue` options are passed to the `Bus` constructor. On application shutdown the provider resolves the singleton and calls `disconnect()`.

Other entries under `transports` are not opened. They are available to `busPrefixedKey` when you pass a connection name. Publishing always goes through the one bus the provider created.

`keyPrefix` is not applied to channel names inside the bus. Call `busPrefixedKey` yourself and publish the string it returns. The prefix is concatenated with the key, so include the separator in the prefix (`bus:` + `orders` is `bus:orders`). An empty prefix returns the key unchanged.

Resolving `bus` throws if `config/bus` is missing, or if the selected transport has no `transport` factory.

## Publish and subscribe

Import the service after the application has booted. The module waits for the `booted` hook, then resolves the container binding. Importing it earlier leaves the export unset until that hook runs.

```ts
import bus from '@ifullgaz/adonis-bus/services/bus'
import { busPrefixedKey } from '@ifullgaz/adonis-bus'

await bus.subscribe(busPrefixedKey('orders'), (message) => {
  console.log(message)
})

const published = await bus.publish(busPrefixedKey('orders'), { id: 1 })
```

You can resolve the same singleton from the container. The provider adds `bus` to the container bindings.

```ts
const bus = await app.container.make('bus')
```

`publish` resolves `true` when the transport accepts the message. It resolves `false` when publishing throws and the message is stored in the retry queue, or when the retry queue refuses it. A handler on this same bus does not run for that publish. Subscribers in other processes, connected with the same Redis or MQTT transport, receive it.

Payloads must be serializable: strings, numbers, booleans, `null`, arrays, and plain objects of those values.

`subscribe` and `unsubscribe` take a channel name. `disconnect` closes the transport and stops the retry timer. Shutdown already does this.

## Channel prefixes

`busPrefixedKey` reads the booted application config.

```ts
import { busPrefixedKey } from '@ifullgaz/adonis-bus'

busPrefixedKey('orders')
busPrefixedKey('orders', 'mqtt')
```

The first call uses the default transport. The second uses the `mqtt` entry's `keyPrefix`, even though the provider did not open that transport. Pass the returned string to `publish` or `subscribe` on the bus that is actually connected.

The helper throws a `RuntimeException` when:

- `config/bus` is missing
- no default is set and you omit the connection name
- the default or the connection name is an empty string
- the selected name is not in `transports`

## Several transports

List every transport in `config/bus.ts`. Set `default` to the one the process should open.

```ts
import { defineConfig } from '@ifullgaz/adonis-bus'
import { redis } from '@boringnode/bus/transports/redis'
import { mqtt } from '@boringnode/bus/transports/mqtt'

export default defineConfig({
  default: 'redis',
  transports: {
    redis: {
      transport: redis({ host: 'localhost', port: 6379 }),
      keyPrefix: 'redis:',
    },
    mqtt: {
      transport: mqtt({ host: 'localhost', port: 1883 }),
      keyPrefix: 'mqtt/',
    },
  },
})
```

With `default: 'redis'`, the container bus uses Redis. `busPrefixedKey('orders', 'mqtt')` returns `mqtt/orders` and does not open an MQTT connection.

Redis accepts an `ioredis` options object, a connection URL, or an existing `Redis` or `Cluster` client. MQTT requires `host` and accepts `port`, `protocol`, and an `options` object forwarded to the MQTT client. See the [`@boringnode/bus` readme](https://github.com/boringnode/bus) for transport behavior, including MQTT wildcards and Redis Cluster ordering.

## Retry queue

A failed `publish` can be stored and sent again. Options live on the transport that the provider opens:

| Option | Role |
| --- | --- |
| `enabled` | Queue failed publishes. The bus default is `true`. |
| `removeDuplicates` | Keep one copy of the same channel and payload. The bus default is `true`. |
| `maxSize` | Maximum queued messages. The oldest is dropped when the cap is reached. The bus default is `null` (no cap). |
| `retryInterval` | Delay between automatic retries. A number is milliseconds. A string such as `'100ms'` is parsed by [`ms`](https://github.com/lukeed/ms). `false` disables the timer. Call `processErrorRetryQueue()` yourself in that case. |

When `retryQueue` is omitted, those bus defaults apply and no timer is started.

The queue retries publishing. A successful publish does not mean a subscriber was connected when the message was sent.

## Tests

Use the memory transport. Buses in the same process share it, and a bus still ignores its own messages, so a test needs a second `Bus` to observe a publish.

```ts
import { Bus } from '@boringnode/bus'
import { memory } from '@boringnode/bus/transports/memory'
import { defineConfig } from '@ifullgaz/adonis-bus'

export default defineConfig({
  default: 'memory',
  transports: {
    memory: {
      transport: memory(),
      keyPrefix: '',
    },
  },
})
```

```ts
import { Bus } from '@boringnode/bus'
import { memory } from '@boringnode/bus/transports/memory'
import bus from '@ifullgaz/adonis-bus/services/bus'

const peer = new Bus(memory()())
await peer.subscribe('orders', (message) => {
  console.log(message)
})
await bus.publish('orders', { id: 1 })
await peer.disconnect()
```

## Imports

| Specifier | Exports |
| --- | --- |
| `@ifullgaz/adonis-bus` | `configure`, `defineConfig`, `busPrefixedKey`, `stubsRoot` |
| `@ifullgaz/adonis-bus/configure` | `configure` |
| `@ifullgaz/adonis-bus/provider` | default export `BusProvider` |
| `@ifullgaz/adonis-bus/services/bus` | default export, the container bus |
| `@ifullgaz/adonis-bus/types` | `BusConfig`, `KnownTransports`, `TransportConfig` |

```ts
import { defineConfig, busPrefixedKey } from '@ifullgaz/adonis-bus'
import type { BusConfig, KnownTransports, TransportConfig } from '@ifullgaz/adonis-bus/types'
import bus from '@ifullgaz/adonis-bus/services/bus'
```

`stubsRoot` is the directory of the package stubs. The configure hook uses it. Application code does not need it.

`TransportConfig` is `{ transport, keyPrefix, retryQueue? }`. `BusConfig` is `{ default?, transports }`. `KnownTransports` is the map of named `TransportConfig` entries.

## Contribute

Node.js 24 or newer is required. Install dependencies from the repository root:

```sh
npm install
```

You can also build the Node 24 image and run commands in that container. `docker-compose.yml` mounts this directory at `/app`.

```sh
docker compose up -d
docker exec -it adonis-bus-adonis-bus-1 npm install
```

| Script | What it does |
| --- | --- |
| `npm run lint` | ESLint, using `@adonisjs/eslint-config` |
| `npm run format` | Prettier, using `@adonisjs/prettier-config` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run quick:test` | Japa tests |
| `npm test` | Lint, then tests with c8 coverage |
| `npm run build` | Lint, bundle with tsdown, emit declarations, copy stubs |

Push and pull request events run lint, typecheck, and tests on Node.js 24, on Ubuntu and Windows.

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`). Releases are cut with `release-it` and the Angular changelog preset, from the manual `release` workflow.

The license is MIT.
