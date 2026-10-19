import type { Attachment, ChatRequest, SSEEvent, ThreadInfo, ThreadMessages } from '../types'

const CHAT_URL = '/api/v1/chat'

async function getJSON<T>(url: string): Promise<T> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`请求失败：HTTP ${resp.status}`)
  return (await resp.json()) as T
}

/**
 * 上传对话附件。
 * 文件落盘后由后端以 MCP resource（upload://）形式暴露，读取走同一条资源链路。
 */
export async function uploadAttachment(file: File): Promise<Attachment> {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch('/api/v1/attachments', { method: 'POST', body: form })
  if (!resp.ok) {
    // 后端用 {detail} 说明失败原因（扩展名 / 大小 / 编码），优先展示它
    const detail = await resp
      .json()
      .then((d: { detail?: string }) => d.detail)
      .catch(() => undefined)
    throw new Error(detail ?? `上传失败：HTTP ${resp.status}`)
  }
  return (await resp.json()) as Attachment
}

/**
 * 已上传附件的访问地址（图片可直接用作 <img src>）。
 * 历史消息里后端只回传文件名，图片实体由这个接口按需提供，避免响应体里塞 base64。
 */
export function attachmentUrl(name: string): string {
  return `/api/v1/attachments/${encodeURIComponent(name)}`
}

/** 获取会话列表（按最近活跃倒序） */
export function fetchThreads(limit = 50): Promise<ThreadInfo[]> {
  return getJSON<ThreadInfo[]>(`/api/v1/threads?limit=${limit}`)
}

/** 获取指定会话的历史消息（interrupt 非空表示后端仍在等待用户回答） */
export function fetchThreadMessages(threadId: string): Promise<ThreadMessages> {
  return getJSON<ThreadMessages>(`/api/v1/threads/${encodeURIComponent(threadId)}/messages`)
}

/** 删除指定会话 */
export function deleteThread(threadId: string): Promise<{ deleted: string }> {
  return fetch(`/api/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
  }).then(async (resp) => {
    if (!resp.ok) throw new Error(`请求失败：HTTP ${resp.status}`)
    return (await resp.json()) as { deleted: string }
  })
}

/**
 * 解析一个 SSE 数据块（以空行分隔的一段）。
 * 支持 event: / data: 行；以 ":" 开头的注释行（心跳）直接忽略。
 */
function parseSSEBlock(block: string): SSEEvent | null {
  const lines = block.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue // 心跳注释行
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) } as SSEEvent
  } catch {
    return null // 无法解析的块直接丢弃
  }
}

/**
 * 通过 fetch POST 流式调用后端对话接口，逐条产出 SSE 事件。
 * EventSource 不支持 POST，因此用 ReadableStream 手动解析。
 */
export async function* streamChat(
  req: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  if (!resp.ok) {
    throw new Error(`请求失败：HTTP ${resp.status}`)
  }
  if (!resp.body) {
    throw new Error('响应无内容')
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // 一个事件块可能被拆分到多个 chunk，用缓冲累积到 \n\n 再解析
    let idx = buffer.indexOf('\n\n')
    while (idx >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const evt = parseSSEBlock(block)
      if (evt) yield evt
      idx = buffer.indexOf('\n\n')
    }
  }
  const evt = parseSSEBlock(buffer)
  if (evt) yield evt
}
