import { useAgent } from '@cloudflare/agents/react'
import { useState } from 'react'

interface Message {
  text: string
  type: 'user' | 'agent' | 'update'
}

type ServerMessage =
  | string
  | { type: 'tool-call'; toolName: string; args: Record<string, any> }
  | { type: 'tool-result'; toolName: string; result: any }

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const agent = useAgent({
    agent: 'my-agent',
    onOpen: () => {
      setMessages((prev) => [...prev, { type: 'update', text: 'Connected...' }])
    },
    onMessage: (message) => {
      setMessages((prev) => {
        const data = JSON.parse(message.data) as ServerMessage
        const next: Message =
          typeof data === 'string'
            ? { text: data, type: 'agent' }
            : data.type === 'tool-call'
              ? { text: `${data.toolName} ➡️\n${JSON.stringify(data.args)}`, type: 'update' }
              : { text: `⬅️ ${data.toolName}\n${JSON.stringify(data.result)}`, type: 'update' }
        return [...prev, next]
      })
      setIsLoading(false)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setMessages((prev) => [...prev, { text: userMessage, type: 'user' }])
    setInput('')
    setIsLoading(true)
    agent.send(userMessage)
  }

  return (
    <div className="min-h-screen">
      <div className="chat-container">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.type}-message`}>
            {message.text}
          </div>
        ))}
        {isLoading && <div className="message update-message">Thinking...</div>}
      </div>

      <form onSubmit={handleSubmit} className="input-container">
        <div className="input-wrapper">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="chat-input"
            disabled={isLoading}
          />
          <button type="submit" className="send-button" disabled={isLoading}>
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
