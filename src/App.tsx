import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  ConfigProvider,
  Empty,
  Input,
  Layout,
  message,
  Popconfirm,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  FundOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import ChatMessage from './components/ChatMessage'
import {
  attachmentUrl,
  deleteThread,
  fetchThreadMessages,
  fetchThreads,
  streamChat,
  uploadAttachment,
} from './api/chat'
import type {
  Attachment,
  ChatMessage as ChatMessageType,
  HistoryMessage,
  ThreadInfo,
} from './types'
import './App.css'

const { Header, Content, Footer, Sider } = Layout

const THREAD_KEY = 'agent_thread_id'

dayjs.locale('zh-cn')

/** 图片过大时先用 canvas 等比压缩。
 *
 *  图片会以 base64 存进会话检查点，且每一轮都要随消息送给模型，手机原图（动辄
 *  5MB+）既撑大存储也白烧 token。这里压到长边 1600px 内、JPEG 0.85，失败就用原图。
 */
async function compressImage(file: File): Promise<File> {
  const MAX_EDGE = 1600
  const MAX_BYTES = 1_500_000
  if (!file.type.startsWith('image/') || file.size <= MAX_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    )
    // 压完反而更大（例如本来就是小尺寸图）就保留原图
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  } catch {
    return file // 浏览器不支持或解码失败：不阻塞上传，交给后端校验
  }
}

/**
 * 后端历史消息（含工具调用）转换为前端消息模型。
 * pendingQuestion 非空时（会话停在后端 ask_user 中断点），把最后一处未完成的工具调用标为等待回答。
 */
function historyToMessages(
  history: HistoryMessage[],
  pendingQuestion?: string | null,
): ChatMessageType[] {
  const result: ChatMessageType[] = []
  for (const m of history) {
    if (m.role === 'user') {
      result.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: m.content,
        images: (m.images ?? []).map(attachmentUrl),
      })
      continue
    }
    if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        // ask_user 尚未拿到结果时即为"等待回答"；后续 ToolMessage 会把它置为完成
        status: tc.name === 'ask_user' ? ('waiting' as const) : ('running' as const),
      }))
      const last = result[result.length - 1]
      // 同一轮回复在后端会拆成多条消息（工具调用 + 最终正文），合并到同一气泡
      if (last && last.role === 'assistant' && (calls.length > 0 || !last.content)) {
        if (calls.length > 0) last.toolCalls = [...(last.toolCalls ?? []), ...calls]
        if (m.content) last.content = last.content ? `${last.content}\n\n${m.content}` : m.content
      } else {
        result.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: m.content,
          toolCalls: calls,
        })
      }
      continue
    }
    if (m.role === 'tool') {
      const last = [...result]
        .reverse()
        .find((x) => x.role === 'assistant' && (x.toolCalls?.length ?? 0) > 0)
      if (!last) continue
      const calls = last.toolCalls!
      const byId = m.tool_call_id ? calls.findIndex((c) => c.id === m.tool_call_id) : -1
      const idx = byId >= 0 ? byId : calls.findIndex((c) => c.status === 'running')
      if (idx >= 0) calls[idx] = { ...calls[idx], status: 'done', result: m.content }
    }
  }

  if (pendingQuestion) {
    for (let i = result.length - 1; i >= 0; i--) {
      const msg = result[i]
      if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue
      const idx = msg.toolCalls.findIndex((c) => c.status !== 'done')
      if (idx < 0) continue
      msg.toolCalls[idx] = { ...msg.toolCalls[idx], status: 'waiting' }
      msg.question = pendingQuestion
      break
    }
  }
  return result
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(() =>
    localStorage.getItem(THREAD_KEY),
  )
  const [threads, setThreads] = useState<ThreadInfo[]>([])
  // 初始即处于加载态：首屏加载会话列表时无需在 effect 中同步 setState
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  // 后端 ask_user 中断待回答的问题：非空时输入框内容将作为回答（resume）发送
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  // 本轮附件：用户上传的文件（application-driven，随本轮发送后清空）
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true)
    try {
      setThreads(await fetchThreads())
    } catch {
      message.error('会话列表加载失败')
    } finally {
      setThreadsLoading(false)
    }
  }, [])

  // 初始加载会话列表；若本地存有上次会话 ID，则同时恢复其历史消息
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await fetchThreads()
        if (!cancelled) setThreads(data)
      } catch {
        if (!cancelled) message.error('会话列表加载失败')
      } finally {
        if (!cancelled) setThreadsLoading(false)
      }
    }
    void load()

    // 刷新后恢复上次会话：threadId 已从 localStorage 初始化，这里补拉该会话的历史消息
    const savedThreadId = localStorage.getItem(THREAD_KEY)
    const restore = async () => {
      if (!savedThreadId) return
      setHistoryLoading(true)
      try {
        const { messages: history, interrupt } = await fetchThreadMessages(savedThreadId)
        if (cancelled) return
        setMessages(historyToMessages(history, interrupt?.question))
        setPendingQuestion(interrupt?.question ?? null)
      } catch {
        if (!cancelled) {
          // 会话可能已被删除/接口异常：清掉本地记录，回到新会话
          setMessages([])
          setThreadId(null)
          setPendingQuestion(null)
          localStorage.removeItem(THREAD_KEY)
        }
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  // 新消息 / 流式更新时自动滚动到底部
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const newSession = () => {
    abortRef.current?.abort()
    setMessages([])
    setThreadId(null)
    setPendingQuestion(null)
    localStorage.removeItem(THREAD_KEY)
    void loadThreads()
  }

  const openThread = async (tid: string) => {
    if (sending || tid === threadId) return
    setHistoryLoading(true)
    try {
      const { messages: history, interrupt } = await fetchThreadMessages(tid)
      abortRef.current?.abort()
      // 会话若停在后端中断点，恢复"等待回答"状态，否则该会话无法继续
      setMessages(historyToMessages(history, interrupt?.question))
      setPendingQuestion(interrupt?.question ?? null)
      setThreadId(tid)
      localStorage.setItem(THREAD_KEY, tid)
    } catch {
      message.error('历史消息加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  const removeThread = async (tid: string) => {
    try {
      await deleteThread(tid)
      setThreads((prev) => prev.filter((t) => t.thread_id !== tid))
      if (threadId === tid) newSession()
    } catch {
      message.error('会话删除失败')
    }
  }

  /** 上传文件作为本轮附件（页面拖拽与点击选择共用）。
   *  用 useCallback 固定引用，才能安全地作为下面的窗口拖拽监听的依赖。 */
  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    try {
      // 图片先压缩再上传（文本原样透传），避免大图撑大上下文与检查点
      const prepared = await Promise.all(files.map(compressImage))
      const uploaded = await Promise.all(prepared.map((f) => uploadAttachment(f)))
      setAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '附件上传失败')
    } finally {
      setUploading(false)
    }
  }, [])

  // 页面级拖拽上传：文件拖到窗口任意位置都能接收，不必对准某个输入框。
  // 用 window 监听而不是给某个元素绑事件，是因为 dragleave 在子元素间移动时会反复
  // 触发；这里用 depth 计数判断"是否真的离开了整个窗口"。
  useEffect(() => {
    let depth = 0

    /** 只接管文件拖拽，忽略选中文本/元素的拖动 */
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth += 1
      setDragActive(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault() // 不阻止默认行为的话，浏览器会直接用文件打开新页面
    }
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragActive(false)
      void uploadFiles(Array.from(e.dataTransfer?.files ?? []))
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [uploadFiles])

  /** 执行一轮流式对话；resume=true 表示本条内容是对上一轮 ask_user 提问的回答 */
  const runStream = async (text: string, resume: boolean) => {
    if (!text || sending) return
    // thread_id：首次会话本地生成并持久化，后续轮次复用（服务端已按此实现多轮记忆）
    const tid = threadId ?? crypto.randomUUID()
    const asstId = crypto.randomUUID()
    setThreadId(tid)
    localStorage.setItem(THREAD_KEY, tid)
    // 本轮的图片附件：立即用后端地址显示在用户气泡里（图片已落盘，可直接访问）
    const imageUrls = attachments
      .filter((a) => a.kind === 'image')
      .map((a) => attachmentUrl(a.name))
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        images: imageUrls.length > 0 ? imageUrls : undefined,
      },
      { id: asstId, role: 'assistant', content: '', streaming: true, toolCalls: [] },
    ])
    setInput('')
    setSending(true)
    // 附件只作用于本轮：发完即清空，避免每轮都塞进上下文导致历史膨胀
    setAttachments([])
    // 本轮已携带回答，清掉待回答态；若后端再次提问会由 ask_user 事件重新设置
    setPendingQuestion(null)

    const ac = new AbortController()
    abortRef.current = ac
    const patch = (fn: (m: ChatMessageType) => ChatMessageType) =>
      setMessages((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)))

    try {
      for await (const evt of streamChat(
        {
          message: text,
          thread_id: tid,
          resume,
          resource_uris: attachments.map((a) => a.uri),
        },
        ac.signal,
      )) {
        switch (evt.event) {
          case 'token': // 流式 token，逐段追加
            patch((m) => ({ ...m, content: m.content + evt.data.content }))
            break
          case 'tool_call': // 新增工具调用（ask_user 为等待用户回答）
            patch((m) => ({
              ...m,
              toolCalls: [
                ...(m.toolCalls ?? []),
                {
                  id: evt.data.id,
                  name: evt.data.name,
                  args: evt.data.args,
                  status: evt.data.name === 'ask_user' ? 'waiting' : 'running',
                },
              ],
            }))
            break
          case 'tool_result': // 工具结果：匹配第一条执行中/等待回答的调用（MCP 工具通常串行）
            patch((m) => {
              const calls = m.toolCalls ?? []
              const idx = calls.findIndex((c) => c.status === 'running' || c.status === 'waiting')
              if (idx < 0) return m
              const updated = [...calls]
              updated[idx] = { ...updated[idx], status: 'done', result: evt.data.content }
              return { ...m, toolCalls: updated }
            })
            break
          case 'ask_user': // 后端中断提问：本轮结束，等待用户回答后以 resume=true 续答
            setPendingQuestion(evt.data.question)
            patch((m) => ({ ...m, question: evt.data.question }))
            break
          case 'done': // 流结束：以服务端 thread_id 为准
            setThreadId(evt.data.thread_id)
            localStorage.setItem(THREAD_KEY, evt.data.thread_id)
            if (!evt.data.awaiting_user) setPendingQuestion(null)
            break
          case 'error':
            patch((m) => ({ ...m, error: evt.data.content }))
            break
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        patch((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }))
      }
    } finally {
      patch((m) => ({ ...m, streaming: false }))
      setSending(false)
      abortRef.current = null
      void loadThreads() // 刷新会话列表（新会话 / 最新活跃时间）
    }
  }

  const send = () => {
    const text = input.trim()
    if (!text || sending) return
    // 存在待回答的问题时，输入内容即回答（恢复后端被中断的图）
    return runStream(text, pendingQuestion !== null)
  }

  return (
    <ConfigProvider locale={zhCN}>
      <Layout className="app-layout">
        <Sider width={280} theme="light" className="app-sider">
          <div className="sider-head">
            <Typography.Text strong>会话历史</Typography.Text>
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => void loadThreads()}
            />
          </div>
          <div className="sider-body">
            {threadsLoading ? (
              <Spin className="sider-spin" />
            ) : threads.length === 0 ? (
              <Empty
                className="sider-empty"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无历史会话"
              />
            ) : (
              threads.map((t) => (
                <div
                  key={t.thread_id}
                  className={`thread-item${t.thread_id === threadId ? ' active' : ''}`}
                  onClick={() => void openThread(t.thread_id)}
                >
                  <MessageOutlined className="thread-item-icon" />
                  <div className="thread-item-text">
                    <div className="thread-item-preview">{t.preview || t.thread_id.slice(0, 12)}</div>
                    <div className="thread-item-meta">
                      {t.last_active ? dayjs(t.last_active).format('MM-DD HH:mm') : ''}
                    </div>
                  </div>
                  <Popconfirm
                    title="删除该会话？"
                    onConfirm={(e) => {
                      e?.stopPropagation()
                      void removeThread(t.thread_id)
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      className="thread-item-del"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
              ))
            )}
          </div>
        </Sider>

        <Layout className="app-main">
          <Header className="app-header">
            <Typography.Title level={4} style={{ margin: 0, color: '#fff' }}/>
            <span className="app-header-right">
              {threadId ? (
                <Tag color="green">会话 {threadId.slice(0, 8)}…</Tag>
              ) : (
                <Tag>新会话</Tag>
              )}
              <Button
                icon={<FundOutlined />}
                onClick={() => window.open('#/knowledge', '_blank')}
                style={{ marginInlineStart: 12 }}
              >
                知识库可视化
              </Button>
              <Button
                icon={<PlusOutlined />}
                onClick={newSession}
                disabled={sending}
                style={{ marginInlineStart: 8 }}
              >
                新会话
              </Button>
            </span>
          </Header>

          <Content className="app-content" ref={listRef}>
            {historyLoading ? (
              <div className="app-loading">
                <Spin tip="加载历史对话..." />
              </div>
            ) : messages.length === 0 ? (
              <Empty
                className="app-empty"
                description="我是智能助手，可以调用工具帮你完成文件、命令、GUI 等任务"
              />
            ) : (
              messages.map((m) => <ChatMessage key={m.id} msg={m} />)
            )}
          </Content>

          <Footer className="app-footer">
            <div
              className={`footer-dropzone${dragActive ? ' footer-dropzone-active' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void uploadFiles(Array.from(e.target.files ?? []))
                  e.target.value = '' // 清空以便重复选择同一个文件
                }}
              />
              <Button
                size="small"
                type="text"
                icon={<PaperClipOutlined />}
                loading={uploading}
                disabled={sending}
                onClick={() => fileInputRef.current?.click()}
              >
                添加附件
              </Button>
              <span className="footer-dropzone-hint">
                支持文本与图片：可直接粘贴，也可拖到页面任意位置
              </span>
              {attachments.map((a) => (
                <Tag
                  key={a.uri}
                  className="footer-attachment"
                  closable
                  onClose={() =>
                    setAttachments((prev) => prev.filter((x) => x.uri !== a.uri))
                  }
                >
                  {a.kind === 'image' && (
                    <img
                      className="footer-attachment-thumb"
                      src={attachmentUrl(a.name)}
                      alt=""
                    />
                  )}
                  {a.name}
                </Tag>
              ))}
            </div>
            {pendingQuestion && (
              <Alert
                className="footer-question"
                type="warning"
                showIcon
                message="助手正在等待你的回答"
                description={pendingQuestion}
              />
            )}
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                // 剪贴板里带文件时接管（截图、复制的文件）；纯文本粘贴保持默认行为
                const files = Array.from(e.clipboardData?.files ?? [])
                if (files.length === 0) return
                e.preventDefault() // 否则文件名 / HTML 片段也会被粘进输入框
                void uploadFiles(files)
              }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={
                pendingQuestion
                  ? '输入你的回答，Enter 提交，Shift+Enter 换行'
                  : '输入消息，Enter 发送，Shift+Enter 换行'
              }
              autoSize={{ minRows: 1, maxRows: 6 }}
              disabled={sending}
              style={{ fontSize: 15 }}
            />
            <div className="app-actions">
              {sending && (
                <Button icon={<StopOutlined />} onClick={() => abortRef.current?.abort()}>
                  停止
                </Button>
              )}
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => void send()}
                loading={sending}
                disabled={!input.trim() || sending}
              >
                {pendingQuestion ? '回答' : '发送'}
              </Button>
            </div>
          </Footer>
        </Layout>
      </Layout>
      {/* 全屏拖拽提示：拖到窗口任意位置都能接收文件 */}
      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">
            <PaperClipOutlined className="drop-overlay-icon" />
            <div>松开鼠标，文件将作为本轮参考资料</div>
          </div>
        </div>
      )}
    </ConfigProvider>
  )
}
