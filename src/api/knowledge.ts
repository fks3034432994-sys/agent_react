import type {
  DeleteEmbeddingResult,
  DeleteSourceResult,
  KnowledgeData,
  KnowledgeDetail,
  UploadResult,
} from '../types'

/** 从失败响应里取出 FastAPI 的 {detail: "..."}，取不到就回落到 HTTP 状态码 */
async function errorDetail(resp: Response, fallback: string): Promise<string> {
  const body = (await resp.json().catch(() => null)) as { detail?: string } | null
  return body?.detail ?? `${fallback}：HTTP ${resp.status}`
}

/** 获取知识库向量化数据（含 PCA 二维坐标） */
export async function fetchKnowledge(collection = 'knowledge_base'): Promise<KnowledgeData> {
  const resp = await fetch(
    `/api/v1/knowledge/embeddings?collection=${encodeURIComponent(collection)}`,
  )
  if (!resp.ok) throw new Error(`请求失败：HTTP ${resp.status}`)
  return (await resp.json()) as KnowledgeData
}

/** 获取单个片段的完整内容（列表接口只给 200 字预览，长片段按需拉取） */
export async function fetchKnowledgeDetail(
  id: string,
  collection = 'knowledge_base',
): Promise<KnowledgeDetail> {
  const resp = await fetch(
    `/api/v1/knowledge/embeddings/${encodeURIComponent(id)}?collection=${encodeURIComponent(
      collection,
    )}`,
  )
  if (!resp.ok) throw new Error(`请求失败：HTTP ${resp.status}`)
  return (await resp.json()) as KnowledgeDetail
}

/** 上传文本文档并向量化入库（同名文件自动替换旧片段） */
export async function uploadDocument(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch('/api/v1/knowledge/documents', {
    method: 'POST',
    body: form,
  })
  if (!resp.ok) {
    // FastAPI 的 HTTPException 返回 {detail: "..."}
    throw new Error(await errorDetail(resp, '上传失败'))
  }
  return (await resp.json()) as UploadResult
}

/** 删除单个向量片段 */
export async function deleteEmbedding(
  id: string,
  collection = 'knowledge_base',
): Promise<DeleteEmbeddingResult> {
  const resp = await fetch(
    `/api/v1/knowledge/embeddings/${encodeURIComponent(id)}?collection=${encodeURIComponent(
      collection,
    )}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new Error(await errorDetail(resp, '删除失败'))
  return (await resp.json()) as DeleteEmbeddingResult
}

/** 按来源删除某文档的全部向量片段（后端默认同时删除知识库目录下的本地文件） */
export async function deleteSource(
  source: string,
  collection = 'knowledge_base',
): Promise<DeleteSourceResult> {
  const resp = await fetch(
    `/api/v1/knowledge/sources?source=${encodeURIComponent(source)}&collection=${encodeURIComponent(
      collection,
    )}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new Error(await errorDetail(resp, '删除失败'))
  return (await resp.json()) as DeleteSourceResult
}
