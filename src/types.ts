// 与后端 app/api/ 的 SSE 协议对应的事件类型
// 后端事件格式：event: <type>\ndata: <json>\n\n（心跳为 ": ping" 注释行，前端忽略）

export interface TokenPayload {
  content: string
}

export interface ToolCallPayload {
  name: string
  args: Record<string, unknown>
  id: string
}

export interface ToolResultPayload {
  name: string
  content: string
}

export interface DonePayload {
  task_completed: boolean
  content: string
  thread_id: string
  /** 为 true 表示图停在中断点，正在等待用户回答（本轮无最终正文） */
  awaiting_user?: boolean
}

/** 后端 ask_user 工具触发的中断：助手需要用户补充信息或确认 */
export interface AskUserPayload {
  question: string
  interrupt_id: string
}

export interface ErrorPayload {
  content: string
}

export type SSEEvent =
  | { event: 'token'; data: TokenPayload }
  | { event: 'tool_call'; data: ToolCallPayload }
  | { event: 'tool_result'; data: ToolResultPayload }
  | { event: 'ask_user'; data: AskUserPayload }
  | { event: 'done'; data: DonePayload }
  | { event: 'error'; data: ErrorPayload }

export interface ChatRequest {
  message: string
  thread_id?: string
  system_prompt?: string
  /** 为 true 时 message 作为对上一轮 ask_user 提问的回答，用于恢复被中断的图 */
  resume?: boolean
  /**
   * 本轮作为参考资料附带的 MCP resource URI（application-driven：由用户在前端勾选，
   * 模型不参与选择；内容由后端读取后注入本轮输入）
   */
  resource_uris?: string[]
}

// ---------- 附件（application-driven：用户上传，经 MCP resource 暴露） ----------

/** POST /api/v1/attachments 的响应项 */
export interface Attachment {
  /** MCP resource URI（upload://<编码后的文件名>），发送时原样回传给后端 */
  uri: string
  /** 文件名 */
  name: string
  /** 字节数 */
  size: number
  /** 字符数（图片为 0） */
  chars: number
  /** image：图片，后端编码为多模态消息注入；text：文本，走 MCP resource 读取 */
  kind: 'text' | 'image'
}

// ---------- 前端消息模型 ----------

export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  /** waiting：ask_user 已提问、正在等用户回答 */
  status: 'running' | 'waiting' | 'done' | 'error'
  result?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  toolCalls?: ToolCallRecord[]
  error?: string
  /** 后端要求用户回答的问题（ask_user 中断） */
  question?: string
  /** 本轮附带的图片地址（/api/v1/attachments/<name>），用户消息专用 */
  images?: string[]
}

// ---------- 会话历史（后端 /threads 接口） ----------

export interface ThreadInfo {
  thread_id: string
  last_active: string | null
  preview: string
  message_count: number
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  name?: string | null
  tool_call_id?: string | null
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[] | null
  /** 该轮用户消息附带的图片文件名（只传名字，实体走 /api/v1/attachments/<name>） */
  images?: string[] | null
}

/** GET /threads/{id}/messages 的响应：会话停在待回答中断点时 interrupt 非空 */
export interface ThreadMessages {
  thread_id: string
  messages: HistoryMessage[]
  interrupt: AskUserPayload | null
}

// ---------- 知识库向量可视化（后端 /knowledge 接口） ----------

export interface KnowledgeSource {
  name: string
  count: number
}

export interface KnowledgePoint {
  id: string
  /** PCA 二维坐标，已归一化到 [0, 1] */
  x: number
  y: number
  source: string
  document: string
}

export interface KnowledgeData {
  collection: string
  total: number
  dim: number
  sources: KnowledgeSource[]
  points: KnowledgePoint[]
}

/** 单个片段的完整内容（详情接口返回，document 不截断） */
export interface KnowledgeDetail {
  id: string
  source: string
  document: string
}

export interface UploadResult {
  filename: string
  chunks: number
  replaced_chunks: number
  source: string
}

/** 删除单个片段的结果 */
export interface DeleteEmbeddingResult {
  deleted: string
  count: number
}

/** 按来源删除的结果（removed_file 表示本地文件是否一并删除） */
export interface DeleteSourceResult {
  source: string
  deleted: number
  removed_file: boolean
}
