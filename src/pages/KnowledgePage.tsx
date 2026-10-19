import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Empty,
  Input,
  message,
  Popconfirm,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  LoadingOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import {
  deleteEmbedding,
  deleteSource,
  fetchKnowledge,
  fetchKnowledgeDetail,
  uploadDocument,
} from '../api/knowledge'
import type { KnowledgePoint } from '../types'
import './KnowledgePage.css'

// 散点配色（按 source 顺序循环取色）
const PALETTE = [
  '#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A',
  '#6DC8EC', '#9270CA', '#FF9D4D', '#269A99', '#FF99C3',
]

// SVG 画布尺寸、边距与内缩（内缩避免最外围的点贴到边框上）
const W = 880
const H = 600
const PAD = 36
const INSET = 0.08

// 数据坐标 [0,1] -> 画布坐标（y 轴翻转）
const px = (x: number) => PAD + (INSET + x * (1 - 2 * INSET)) * (W - 2 * PAD)
const py = (y: number) => H - PAD - (INSET + y * (1 - 2 * INSET)) * (H - 2 * PAD)

export default function KnowledgePage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchKnowledge>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 空数组表示不过滤来源
  const [sourceFilter, setSourceFilter] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<KnowledgePoint | null>(null)
  // 列表接口只返回 200 字预览，抽屉打开后再按 id 拉完整内容
  const [fullDoc, setFullDoc] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  // 正在删除的条目标识：片段为 "id:<id>"，来源为 "source:<name>"，空串表示没有进行中的删除
  const [deleting, setDeleting] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await fetchKnowledge()
      setData(d)
      // 来源被删掉后同步清理过滤条件，避免残留的来源把列表过滤成空
      const names = new Set(d.sources.map((s) => s.name))
      setSourceFilter((prev) => {
        const next = prev.filter((n) => names.has(n))
        return next.length === prev.length ? prev : next
      })
      setError('')
    } catch {
      setError('向量数据加载失败，请确认后端已启动')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 选中片段变化时拉完整内容；cancelled 防止快速切换时旧响应覆盖新内容
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setFullDoc(selected.document) // 先渲染预览，避免抽屉空白
    setDetailLoading(true)
    fetchKnowledgeDetail(selected.id)
      .then((d) => {
        if (!cancelled) setFullDoc(d.document)
      })
      .catch(() => undefined) // 拉取失败时保留预览文本
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  // source -> 颜色
  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    data?.sources.forEach((s, i) => map.set(s.name, PALETTE[i % PALETTE.length]))
    return map
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    const kw = search.trim()
    return data.points.filter(
      (p) =>
        (sourceFilter.length === 0 || sourceFilter.includes(p.source)) &&
        (kw === '' || p.document.includes(kw)),
    )
  }, [data, sourceFilter, search])

  // 每个来源在画布上的聚类标签位置（成员点的质心），随过滤联动
  const clusterLabels = useMemo(() => {
    const groups = new Map<string, { sx: number; sy: number; n: number }>()
    for (const p of filtered) {
      const g = groups.get(p.source) ?? { sx: 0, sy: 0, n: 0 }
      g.sx += px(p.x)
      g.sy += py(p.y)
      g.n += 1
      groups.set(p.source, g)
    }
    return [...groups.entries()].map(([name, g]) => ({
      name,
      x: g.sx / g.n,
      y: g.sy / g.n - 16, // 标签放在簇的上方
    }))
  }, [filtered])

  const back = () => {
    window.close()
    window.location.hash = ''
  }

  const doUpload = async (file: File) => {
    setUploading(true)
    try {
      const r = await uploadDocument(file)
      message.success(
        `已导入「${r.filename}」，生成 ${r.chunks} 个片段` +
          (r.replaced_chunks > 0 ? `（替换旧片段 ${r.replaced_chunks} 个）` : ''),
      )
      await load() // 重新拉取向量数据，散点图立即反映新文档
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  // 删除单个片段；抽屉正展示该片段时一并关闭
  const doDeletePoint = async (point: KnowledgePoint) => {
    setDeleting(`id:${point.id}`)
    try {
      await deleteEmbedding(point.id)
      if (selected?.id === point.id) setSelected(null)
      message.success('已删除该片段')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting('')
    }
  }

  // 删除某个来源文档的全部片段（后端同时清理知识库目录下的本地文件）
  const doDeleteSource = async (source: string) => {
    setDeleting(`source:${source}`)
    try {
      const r = await deleteSource(source)
      if (selected?.source === source) setSelected(null)
      message.success(
        `已删除「${source}」的 ${r.deleted} 个片段` + (r.removed_file ? '，并移除本地文件' : ''),
      )
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting('')
    }
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div className="kv-layout">
        <header className="kv-header">
          <Typography.Title level={4} style={{ margin: 0, color: '#fff' }}>
            知识库向量可视化
          </Typography.Title>
          <Space>
            <Upload
              accept=".txt,.md"
              showUploadList={false}
              beforeUpload={(file) => {
                void doUpload(file)
                return false // 阻止 antd 自动上传，由 doUpload 自行处理
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading}>
                导入文档
              </Button>
            </Upload>
            <Button icon={<ArrowLeftOutlined />} onClick={back}>
              返回对话
            </Button>
          </Space>
        </header>

        <main className="kv-content">
          {loading ? (
            <div className="kv-loading">
              <Spin tip="加载向量数据..." />
            </div>
          ) : error ? (
            <Empty className="kv-empty" description={error} />
          ) : !data || data.total === 0 ? (
            <Empty className="kv-empty" description="知识库暂无向量化数据" />
          ) : (
            <>
              <Space size={16} className="kv-stats">
                <Card className="kv-stat-card">
                  <Statistic title="向量片段" value={data.total} />
                </Card>
                <Card className="kv-stat-card">
                  <Statistic title="来源文件" value={data.sources.length} />
                </Card>
                <Card className="kv-stat-card">
                  <Statistic title="向量维度" value={data.dim} />
                </Card>
              </Space>

              <Card
                title="PCA 二维投影（同色点来自同一文件，距离越近语义越相似）"
                size="small"
                classNames={{ body: 'kv-scatter-card' }}
                extra={
                  <Space>
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="按来源过滤"
                      style={{ minWidth: 220, maxWidth: 380 }}
                      value={sourceFilter}
                      onChange={setSourceFilter}
                      maxTagCount="responsive"
                      options={data.sources.map((s) => ({ value: s.name, label: s.name }))}
                    />
                    <Input
                      allowClear
                      prefix={<SearchOutlined />}
                      placeholder="搜索内容"
                      style={{ width: 180 }}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </Space>
                }
              >
                <div className="kv-legend">
                  {data.sources.map((s) => (
                    <span
                      key={s.name}
                      className={`kv-legend-item${
                        sourceFilter.length > 0 && !sourceFilter.includes(s.name) ? ' dim' : ''
                      }`}
                      onClick={() =>
                        setSourceFilter((prev) =>
                          prev.includes(s.name)
                            ? prev.filter((x) => x !== s.name)
                            : [...prev, s.name],
                        )
                      }
                    >
                      <i style={{ background: colorOf.get(s.name) }} />
                      {s.name}（{s.count}）
                      <Popconfirm
                        title="删除该来源的全部向量？"
                        description={`将删除「${s.name}」的 ${s.count} 个片段，并移除知识库目录下的同名文件。`}
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        cancelText="取消"
                        onConfirm={() => void doDeleteSource(s.name)}
                      >
                        {/* 阻止冒泡，点删除图标不触发来源过滤 */}
                        <span
                          className="kv-legend-del"
                          onClick={(e) => e.stopPropagation()}
                          role="button"
                          aria-label={`删除来源 ${s.name}`}
                          title="删除该来源"
                        >
                          {deleting === `source:${s.name}` ? (
                            <LoadingOutlined spin />
                          ) : (
                            <DeleteOutlined />
                          )}
                        </span>
                      </Popconfirm>
                    </span>
                  ))}
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} className="kv-scatter" role="img">
                  <rect
                    x={PAD}
                    y={PAD}
                    width={W - PAD * 2}
                    height={H - PAD * 2}
                    fill="#fafafa"
                    stroke="#eee"
                    rx={6}
                  />
                  {/* 浅色网格线 */}
                  {[0.2, 0.4, 0.6, 0.8].map((t) => (
                    <g key={t} stroke="#ececec" strokeDasharray="4 6">
                      <line x1={px(t)} y1={PAD} x2={px(t)} y2={H - PAD} />
                      <line x1={PAD} y1={py(t)} x2={W - PAD} y2={py(t)} />
                    </g>
                  ))}
                  {filtered.map((p) => (
                    <circle
                      key={p.id}
                      cx={px(p.x)}
                      cy={py(p.y)}
                      r={10}
                      fill={colorOf.get(p.source) ?? '#999'}
                      fillOpacity={0.9}
                      stroke="#fff"
                      strokeWidth={2}
                      className="kv-dot"
                      onClick={() => setSelected(p)}
                    >
                      <title>{`来源：${p.source}\n${p.document.slice(0, 80)}…`}</title>
                    </circle>
                  ))}
                  {/* 聚类标签：直接在图上标出各来源的位置 */}
                  {clusterLabels.map((c) => (
                    <text
                      key={c.name}
                      x={c.x}
                      y={c.y}
                      textAnchor="middle"
                      className="kv-cluster-label"
                    >
                      {c.name.split(/[\\/]/).pop()}
                    </text>
                  ))}
                </svg>
              </Card>

              <Card title="片段明细" size="small">
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={filtered}
                  pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
                  columns={[
                    {
                      title: '来源',
                      dataIndex: 'source',
                      width: 280,
                      render: (v: string) => (
                        <Tag color={colorOf.get(v)}>{v}</Tag>
                      ),
                    },
                    { title: '内容', dataIndex: 'document', ellipsis: true },
                    {
                      title: '操作',
                      width: 150,
                      render: (_: unknown, r: KnowledgePoint) => (
                        <Space size={0}>
                          <Button type="link" size="small" onClick={() => setSelected(r)}>
                            查看
                          </Button>
                          <Popconfirm
                            title="删除该片段？"
                            description="删除后该片段不再参与检索，且无法恢复。"
                            okText="删除"
                            okButtonProps={{ danger: true }}
                            cancelText="取消"
                            onConfirm={() => void doDeletePoint(r)}
                          >
                            <Button
                              type="link"
                              size="small"
                              danger
                              loading={deleting === `id:${r.id}`}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            </>
          )}
        </main>

        <Drawer
          title="片段详情"
          width={520}
          open={selected !== null}
          onClose={() => setSelected(null)}
          footer={
            selected && (
              <Space>
                <Popconfirm
                  title="删除该片段？"
                  description="删除后该片段不再参与检索，且无法恢复。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => void doDeletePoint(selected)}
                >
                  <Button danger icon={<DeleteOutlined />} loading={deleting === `id:${selected.id}`}>
                    删除该片段
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="删除该来源的全部片段？"
                  description={`将删除「${selected.source}」的全部片段，并移除知识库目录下的同名文件。`}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => void doDeleteSource(selected.source)}
                >
                  <Button
                    danger
                    type="text"
                    loading={deleting === `source:${selected.source}`}
                  >
                    删除整个文件
                  </Button>
                </Popconfirm>
              </Space>
            )
          }
        >
          {selected && (
            <>
              <p className="kv-drawer-meta">
                <Tag color={colorOf.get(selected.source)}>{selected.source}</Tag>
              </p>
              <p className="kv-drawer-meta kv-drawer-id">
                id: {selected.id}
                {detailLoading && <Spin size="small" style={{ marginLeft: 8 }} />}
              </p>
              <pre className="kv-drawer-content">{fullDoc}</pre>
            </>
          )}
        </Drawer>
      </div>
    </ConfigProvider>
  )
}
