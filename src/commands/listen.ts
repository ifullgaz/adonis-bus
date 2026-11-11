import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { type Serializable } from '@boringnode/bus/types/main'
import { randomUUID } from 'node:crypto'

type CommandMessage = { [key: string]: Serializable }

export default class BusListen extends BaseCommand {
  static commandName = 'bus:listen'
  static description =
    'Subscribe to the bus "command" channel and process messages until terminated'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: true,
  }

  async run() {
    const bus = await this.app.container.make('bus')
    await bus.subscribe<CommandMessage>('command', (message) => {
      this.logger.info(`[bus:listen] received message: ${JSON.stringify(message)}`)
      this.onMessage(message)
    })

    this.logger.info('[bus:listen] subscribed to channel "command", waiting for messages...')
  }

  private async onMessage(message: CommandMessage) {
    const action = message['action'] as string
    const id = message['id'] as string | undefined

    const response = this.buildResponse(action)

    if (response === null) {
      this.logger.info(`[bus:listen] action "${action}" requested no response`)
      return
    }

    if (id) {
      const bus = await this.app.container.make('bus')
      await bus.publish(`response:${id}`, { action: action, ...response })
      this.logger.info(`[bus:listen] sent response → ${JSON.stringify(response)}`)
    } else {
      this.logger.warning('[bus:listen] message has no id, cannot send response')
    }
  }

  private buildResponse(action: string): Record<string, Serializable> | null {
    const id = randomUUID()
    switch (action) {
      case 'ping':
        return { id, result: 'pong' }
      case 'timeout':
        return null
      case 'shutdown':
        this.app.terminate()
        return { id, result: 'shutting down' }
      default:
        return { id, result: 'unknown', receivedAction: action }
    }
  }
}
