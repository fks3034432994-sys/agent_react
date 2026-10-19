import { Alert, Avatar, Image } from 'antd'
import { RobotOutlined, UserOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolCallCard from './ToolCallCard'
import type { ChatMessage as ChatMessageType } from '../types'

/** 单条消息气泡：用户消息右对齐，助手消息左对齐并支持 markdown 与工具调用卡片。 */
export default function ChatMessage({ msg }: { msg: ChatMessageType }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`msg-row ${isUser ? 'msg-user' : 'msg-assistant'}`}>
      <Avatar
        className="msg-avatar"
        size={36}
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={isUser ? { background: '#1677ff' } : { background: '#722ed1' }}
      />
      <div className="msg-body">
        {msg.question && (
          <Alert
            type="warning"
            showIcon
            className="msg-question"
            message="需要你的回答"
            description={msg.question}
          />
        )}
        {msg.toolCalls?.map((call) => (
          <ToolCallCard key={call.id} call={call} />
        ))}
        {msg.error && (
          <Alert type="error" showIcon message={msg.error} className="msg-error" />
        )}
        {msg.images && msg.images.length > 0 && (
          <div className="msg-images">
            {msg.images.map((src) => (
              <Image
                key={src}
                className="msg-image"
                src={src}
                alt="附件图片"
                width={160}
              />
            ))}
          </div>
        )}
        {(msg.content || msg.streaming || !msg.question) && (
          <div className={`msg-content ${isUser ? 'msg-bubble-user' : 'msg-bubble-ai'}`}>
            {msg.content ? (
              // remark-gfm 提供表格、删除线、任务列表等 GitHub 风格语法。
              // react-markdown 默认只解析 CommonMark，不装插件时表格会退化成
              // 带一堆 "|" 的普通段落。
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            ) : (
              <span className="msg-placeholder">…</span>
            )}
            {msg.streaming && <span className="cursor" aria-hidden />}
          </div>
        )}
      </div>
    </div>
  )
}
