import { createMimeMessage } from 'mimetext'

export async function sendEmail(
  id: DurableObjectId,
  EMAIL: SendEmail,
  from: string,
  fromName: string,
  fromDomain: string,
  recipient: string,
  subject: string,
  contentType: string,
  body: string
) {
  if (!EMAIL) {
    throw new Error('Email is not configured')
  }

  const msg = createMimeMessage()
  msg.setSender({ name: fromName, addr: from })
  msg.setRecipient(recipient)
  msg.setSubject(subject)
  msg.addMessage({
    contentType: contentType,
    data: body,
  })
  msg.setHeader('Message-ID', `<${idToBase64(id)}@${fromDomain}>`)

  // import this dynamically import { EmailMessage } from 'cloudflare:email'
  const { EmailMessage } = await import('cloudflare:email')
  await EMAIL.send(new EmailMessage(from, recipient, msg.asRaw()))
  return 'Email sent successfully!'
}

export function idToBase64(id: DurableObjectId) {
  return Buffer.from(id.toString(), 'hex').toString('base64')
}

export function base64IDtoString(base64id: string) {
  return Buffer.from(base64id, 'base64').toString('hex')
}
