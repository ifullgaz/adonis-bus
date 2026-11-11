import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { type Serializable } from '@boringnode/bus/types/main'
import { randomUUID } from 'node:crypto'

type ResponseMessage = { [key: string]: Serializable }

const TIMEOUT_MS = 500

export default class BusSend extends BaseCommand {
  static commandName = 'bus:send'
  static description = 'Publish a message to the bus "command" channel and wait for a response'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: true,
  }

  @args.string({ description: 'Action name to send' })
  declare action: string

  @flags.string({ description: 'JSON-encoded payload to merge into the message', alias: 'p' })
  declare payload: string | undefined

  async run() {
    let extra: Record<string, unknown> = {}

    if (this.payload) {
      try {
        extra = JSON.parse(this.payload)
      } catch {
        this.logger.error('Invalid JSON payload')
        this.exitCode = 1
        await this.app.terminate()
        return
      }
    }

    const id = randomUUID()
    const responseChannel = `response:${id}`
    const message = { action: this.action, id, ...extra }

    const timer = setTimeout(() => {
      finish(() =>
        this.logger.error(`[bus:send] timeout waiting for response to "${this.action}" (id: ${id})`)
      )
    }, TIMEOUT_MS)

    const finish = async (logFn: () => void) => {
      clearTimeout(timer)
      logFn()
      this.app.terminate()
    }

    const bus = await this.app.container.make('bus')
    bus
      .subscribe<ResponseMessage>(responseChannel, (response) => {
        finish(() => this.logger.info(`[bus:send] response received: ${JSON.stringify(response)}`))
      })
      .then(async () => {
        this.logger.info(`[bus:send] sending → ${JSON.stringify(message)}`)
        const result = await bus.publish('command', message)
        console.log('result', result)
      })
      .catch((err) => {
        finish(() => this.logger.error(`[bus:send] error: ${err.message}`))
      })
  }
}
