import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import Configure from '@adonisjs/core/commands/configure'

import { bootApplication } from './helpers.js'

const PROVIDER_SPECIFIER = '@ifullgaz/adonis-bus/provider'

test.group('configure', (group) => {
  group.each.timeout(20000)

  test('registers the provider and publishes the bus config stub', async ({ assert }) => {
    const host = await createHostApp()
    try {
      const command = await configureHost(host)
      const rcFile = await readFile(join(host.directory, 'adonisrc.ts'), 'utf8')
      const configFile = await readFile(join(host.directory, 'config', 'bus.ts'), 'utf8')
      const stub = await readFile(new URL('../stubs/config.stub', import.meta.url), 'utf8')

      assert.notEqual(command.exitCode, 1)
      assert.include(rcFile, `() => import('@adonisjs/core/providers/app_provider')`)
      assert.include(rcFile, `() => import('${PROVIDER_SPECIFIER}')`)
      assert.equal(countOccurrences(rcFile, PROVIDER_SPECIFIER), 1)
      assert.equal(normalizeStubOutput(configFile), normalizeStubOutput(stripStubHeader(stub)))
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })

  test('does not register the provider twice', async ({ assert }) => {
    const host = await createHostApp()
    try {
      await configureHost(host)
      await configureHost(host)

      const rcFile = await readFile(join(host.directory, 'adonisrc.ts'), 'utf8')
      assert.equal(countOccurrences(rcFile, PROVIDER_SPECIFIER), 1)
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })

  test('keeps an existing config file unless force is set', async ({ assert }) => {
    const host = await createHostApp()
    try {
      await configureHost(host)
      const configPath = join(host.directory, 'config', 'bus.ts')
      await writeFile(configPath, 'export const marker = true\n')

      await configureHost(host)
      assert.equal(await readFile(configPath, 'utf8'), 'export const marker = true\n')

      await configureHost(host, { force: true })
      const stub = await readFile(new URL('../stubs/config.stub', import.meta.url), 'utf8')
      assert.equal(
        normalizeStubOutput(await readFile(configPath, 'utf8')),
        normalizeStubOutput(stripStubHeader(stub))
      )
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })

  test('writes the config file into a custom config directory', async ({ assert }) => {
    const host = await createHostApp()
    try {
      const app = await bootApplication({
        appRoot: host.url,
        rcFileContents: {
          directories: {
            config: 'settings',
            stubs: 'stubs',
          },
        },
      })
      try {
        await runConfigure(app, { force: false })
      } finally {
        await app.terminate()
      }

      const customConfig = await readFile(join(host.directory, 'settings', 'bus.ts'), 'utf8')
      assert.include(customConfig, 'export default defineConfig(')
      assert.isUndefined(await readOptional(join(host.directory, 'config', 'bus.ts')))
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })
})

test.group('package entry', () => {
  test('exports the public runtime api', async ({ assert }) => {
    const entry = await import('../index.js')
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports: Record<string, string> }
    const stub = await readFile(join(entry.stubsRoot, 'config.stub'), 'utf8')

    assert.deepEqual(Object.keys(entry).sort(), [
      'busPrefixedKey',
      'configure',
      'defineConfig',
      'stubsRoot',
    ])
    assert.isFunction(entry.configure)
    assert.isFunction(entry.defineConfig)
    assert.isFunction(entry.busPrefixedKey)
    assert.equal(manifest.exports['./provider'], './build/providers/provider.js')
    assert.include(stub, 'keyPrefix: "prefix"')
    assert.include(stub, "retryInterval: '100ms'")
  })
})

async function createHostApp() {
  const root = fileURLToPath(new URL('./tmp/', import.meta.url))
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'app-'))
  const url = pathToFileURL(directory)
  url.pathname = `${url.pathname}/`

  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'bus-configure-app', private: true, type: 'module' }, null, 2)}\n`
  )
  await writeFile(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
        },
        include: ['adonisrc.ts'],
      },
      null,
      2
    )}\n`
  )
  await writeFile(
    join(directory, 'adonisrc.ts'),
    `import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  providers: [() => import('@adonisjs/core/providers/app_provider')],
})
`
  )

  return { directory, url }
}

async function configureHost(host: { directory: string; url: URL }, flags?: { force: boolean }) {
  const app = await bootApplication({ appRoot: host.url })
  try {
    return await runConfigure(app, flags)
  } finally {
    await app.terminate()
  }
}

async function runConfigure(
  app: Awaited<ReturnType<typeof bootApplication>>,
  flags?: { force: boolean }
) {
  const ace = await app.container.make('ace')
  const argv = ['@ifullgaz/adonis-bus']
  if (flags?.force) {
    argv.push('--force')
  }
  const command = await ace.create(Configure, argv)
  command.ui.switchMode('silent')
  const { configure } = await import('../configure.js')
  await configure(command)
  return command
}

function normalizeStubOutput(contents: string) {
  return contents.replace(/\r\n/g, '\n').trimEnd()
}

function stripStubHeader(contents: string) {
  const marker = '}}}'
  const start = contents.indexOf(marker)
  if (start === -1) {
    throw new Error('Stub header is missing')
  }
  return contents.slice(start + marker.length).replace(/^\r?\n/, '')
}

function countOccurrences(contents: string, value: string) {
  return contents.split(value).length - 1
}

async function readOptional(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      return undefined
    }
    throw error
  }
}

function isEnoent(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
