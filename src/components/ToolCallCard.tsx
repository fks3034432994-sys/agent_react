import { Card, Collapse, Tag, Typography } from 'antd'
import type { ToolCallRecord } from '../types'

const { Text, Paragraph } = Typography

const STATUS_META = {
  running: { color: 'processing' as const, label: '执行中' },
  waiting: { color: 'warning' as const, label: '等待回答' },
  done: { color: 'success' as const, label: '完成' },
  error: { color: 'error' as const, label: '失败' },
}

/** 工具调用卡片：展示工具名、参数 JSON 与执行结果。 */
export default function ToolCallCard({ call }: { call: ToolCallRecord }) {
  const meta = STATUS_META[call.status]
  const resultText =
    typeof call.result === 'string'
      ? call.result
      : call.result
        ? JSON.stringify(call.result, null, 2)
        : ''

  return (
    <Card
      size="small"
      className="tool-card"
      title={
        <span>
          <Tag color="geekblue">工具</Tag>
          <Text code>{call.name}</Text>
          <Tag color={meta.color} style={{ marginInlineStart: 8 }}>
            {meta.label}
          </Tag>
        </span>
      }
    >
      <Collapse
        size="small"
        ghost
        items={[
          {
            key: 'args',
            label: '参数',
            children: (
              <pre className="tool-json">{JSON.stringify(call.args, null, 2)}</pre>
            ),
          },
          ...(resultText
            ? [
                {
                  key: 'result',
                  label: '结果',
                  children: (
                    <Paragraph
                      className="tool-result"
                      ellipsis={{ rows: 6, expandable: true, symbol: '展开' }}
                    >
                      {resultText}
                    </Paragraph>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Card>
  )
}
