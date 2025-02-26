import { createGroq } from '@ai-sdk/groq'
import { Agent, type Connection, type ConnectionContext, routeAgentRequest, type WSMessage } from '@cloudflare/agents'
import { type CoreAssistantMessage, type CoreMessage, type CoreToolMessage, generateText, tool } from 'ai'
import z from 'zod'
import { base64IDtoString, sendEmail } from './utils'
import PostalMime from 'postal-mime'

const FROM = {
  address: 'agent@gmad.dev',
  name: 'Agent GMad',
  domain: 'gmad.dev',
}

type Env = {
  GROQ_API_KEY: string
  MyAgent: DurableObjectNamespace<MyAgent>
  EMAIL: SendEmail
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
  connection!: Connection

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  onConnect(connection: Connection, ctx: ConnectionContext): void | Promise<void> {
    this.connection = connection
    console.log('Connected to agent')
    // Clear history
    this.messages = RESET
    this.respond({
      role: 'assistant',
      content: `Hello! I'm your AI assistant. How can I help you today?`,
    })
  }

  respond(message: CoreAssistantMessage | CoreToolMessage) {
    this.messages.push(message)
    try {
      // if (message.role === 'tool') {
      //   console.log(message)
      // } else {
      const { content } = message
      if (typeof content === 'string') {
        this.connection.send(JSON.stringify(content))
      } else if (Array.isArray(content)) {
        content.forEach((line) => {
          console.log({ line })
          if (line.type === 'text') {
            if (line.text !== '') this.connection.send(JSON.stringify(line.text))
            // } else if (line.type === 'tool-result') {
            //   connection.send(JSON.stringify(line.result))
          } else {
            this.connection.send(JSON.stringify(line))
          }
        })
      } else {
        this.connection.send(JSON.stringify(content))
      }
      // }
    } catch (error) {
      console.error('Error processing message:', error)
      this.connection.send(`Something went wrong: ${(error as Error).message}`)
    }
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    if (message === 'PING') return

    this.connection = connection
    this.messages.push({ role: 'user', content: message as string })
    console.log('Message from client', message)

    await this.#talkToLLM(true)
  }

  async #talkToLLM(includeTools: boolean) {
    try {
      const response = await generateText({
        model: this.groq('llama-3.3-70b-versatile'),
        messages: this.messages,
        maxTokens: 500,
        tools: includeTools
          ? {
              sendEmail: this.#sendEmail,
            }
          : {},
      })
      console.log(response)

      response.response.messages.forEach((message) => {
        this.respond(message)
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
      console.log({ recipient, subject, contentType, body })

      try {
        const success = await sendEmail(
          this.ctx.id,
          this.env.EMAIL,
          FROM.address,
          FROM.name,
          FROM.domain,
          recipient,
          subject,
          contentType,
          body
        )

        this.messages.push({
          role: 'system',
          content: `The email system replied with: ${JSON.stringify(success)}. Please inform the user, with a summary of what you sent.`,
        })

        // Queue up an LLM call but return immediately
        this.#talkToLLM(false)
        return success
      } catch (e) {
        return `Error: ${(e as any).message}`
      }
    },
  })

  async receiveEmail(from: string, to: string, subject: string, contents: string) {
    console.log({ id: this.ctx.id, from, to, subject, contents })

    this.messages.push({
      role: 'system',
      content: [
        `We have received an email!`,
        `Update the user if this is in response to some conversation they're involved in or information they're waiting for.`,
        `Message follows:`,
        `---`,
        `From: ${JSON.stringify(from)}`,
        `To: ${JSON.stringify(to)}`,
        `Subject: ${JSON.stringify(subject)}`,
        `---`,
        contents,
      ].join('\n'),
    })

    await this.#talkToLLM(false)

    console.log('DID WE DO IT???')
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (await routeAgentRequest(request, env)) || new Response('Not found', { status: 404 })
  },
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    // @ts-ignore
    console.log(Object.fromEntries(message.headers.entries()))
    const parsed = await PostalMime.parse(message.raw)
    console.log(parsed)

    const routingMatch = message.headers.get('references')?.match(/<([A-Za-z0-9+\/]{43}=)@gmad.dev/)
    console.log({ references: message.headers.get('references'), do_match: routingMatch })

    if (routingMatch) {
      const [_, base64id] = routingMatch

      try {
        const ns = env.MyAgent
        const stub = ns.get(ns.idFromString(base64IDtoString(base64id)))
        await stub.receiveEmail(message.from, message.to, message.headers.get('subject')!, parsed.text!)
      } catch (e) {
        console.error(e)
      }
    }
  },
} satisfies ExportedHandler<Env>
