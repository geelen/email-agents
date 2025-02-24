import { createGroq } from '@ai-sdk/groq'
import { Agent, routeAgentRequest, type Connection, type ConnectionContext, type WSMessage } from '@cloudflare/agents'
import { type CoreAssistantMessage, type CoreMessage, type CoreToolMessage, generateText, type Tool, tool } from 'ai'
import z from 'zod'

type Env = {
  GROQ_API_KEY: string
  MyAgent: DurableObjectNamespace<MyAgent>
}

const RESET: CoreMessage[] = [
  {
    role: 'system',
    content: [
      'You are a helpful AI assistant.',
      'You can use tools to help you answer questions, but only use tools if explicitly requested.',
      "Additionally, if asked to use a tool but you don't have precise information for each parameter, you should ask the user for more information.",
    ].join(' '),
  },
]

export class MyAgent extends Agent<Env> {
  groq = createGroq({
    apiKey: this.env.GROQ_API_KEY,
  })
  messages = RESET

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  onConnect(connection: Connection, ctx: ConnectionContext): void | Promise<void> {
    console.log('Connected to agent')
    // Clear history
    this.messages = RESET
    this.respond(connection, {
      role: 'assistant',
      content: `Hello! I'm your AI assistant. How can I help you today?`,
    })
  }

  respond(connection: Connection, message: CoreAssistantMessage | CoreToolMessage) {
    this.messages.push(message)
    try {
      if (message.role === 'tool') {
        console.log('OK')
      } else {
        const { content } = message
        if (typeof content === 'string') {
          connection.send(JSON.stringify(content))
        } else if (Array.isArray(content)) {
          content.forEach((line) => {
            console.log(line)
            if (line.type === 'text') {
              if (line.text !== '') connection.send(JSON.stringify(line.text))
            } else {
              connection.send(JSON.stringify(line))
            }
          })
        } else {
          connection.send(JSON.stringify(content))
        }
      }
    } catch (error) {
      console.error('Error processing message:', error)
      connection.send(`Something went wrong: ${(error as Error).message}`)
    }
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    this.messages.push({ role: 'user', content: message as string })

    try {
      console.log('Message from client', message)
      const response = await generateText({
        model: this.groq('llama-3.3-70b-versatile'),
        messages: this.messages,
        maxTokens: 500,
        tools: {
          sendEmail: this.#sendEmail,
        },
      })
      console.log(response)

      response.response.messages.forEach((message) => {
        this.respond(connection, message)
      })
    } catch (error) {
      console.error('Error processing message:', error)
    }
  }

  #sendEmail = tool({
    description: 'Send a text or HTML email to an arbitrary recipient. You must specify an exact email address, do not invent one.',
    parameters: z.object({
      recipient: z.string().describe(`The email address of the recipient.`),
      subject: z.string().describe(`The subject of the email.`),
      contentType: z.string().describe(`The content type of the email. Can be text/plain or text/html`),
      body: z.string().describe(`The body of the email. Must match the provided contentType parameter`),
    }),
    execute: async ({ recipient, subject, contentType, body }) => {
      console.log('Ok smarty!')
      console.log({ recipient, subject, contentType, body })

      return 'He says hi.'
    },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (await routeAgentRequest(request, env)) || new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
