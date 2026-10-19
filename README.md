# Agent React · 智能体对话前端

基于 **React 19 + TypeScript + Vite + Ant Design** 的智能体（Agent）Web 前端，配套后端为 FastAPI（LangGraph 风格的多轮对话 + MCP 工具调用）。界面提供流式对话、工具调用可视化、附件上传、会话历史与知识库向量可视化四大能力。

> 本仓库**仅包含前端**，后端接口需另行部署（默认 `http://localhost:8000`）。

## 功能特性

### 1. 流式对话（SSE）

- 通过 `fetch` + `ReadableStream` 手动解析 SSE（`EventSource` 不支持 POST），逐 token 渲染。
- 支持事件：`token` / `tool_call` / `tool_result` / `ask_user` / `done` / `error`，心跳注释行自动忽略。
- 可随时点击「停止」中断本轮流式响应（`AbortController`）。

### 2. 人机协作中断（ask_user）

- 后端执行工具时若需用户补充信息或确认，图会停在中断点，前端弹出「等待回答」提示。
- 用户输入内容以 `resume=true` 续答，继续执行被中断的流程。
- 刷新或切换会话时，若该会话仍处于中断态，会自动恢复待回答状态。

### 3. 附件上传（application-driven）

- 支持点击选择、**页面任意位置拖拽**、**剪贴板粘贴**三种方式上传。
- 图片在上传前用 Canvas 压缩（长边 1600px、JPEG 0.85），避免撑大上下文与检查点。
- 文件由后端落盘后以 MCP resource（`upload://`）形式暴露，发送时以 `resource_uris` 回传，仅作用于当前轮次。

### 4. 工具调用可视化

- 每个工具调用渲染为独立卡片，展示工具名、参数 JSON 与执行结果。
- 状态区分：执行中 / 等待回答 / 完成 / 失败。

### 5. 会话历史

- 左侧列表按最近活跃倒序展示会话预览与时间，支持切换、删除、新建会话。
- 当前会话 ID 存入 `localStorage`，刷新页面自动恢复历史消息。
- 消息中的图片只回传文件名，实体按需走 `/api/v1/attachments/<name>` 拉取，避免响应体塞 base64。

### 6. 知识库向量可视化

- 独立页面（`#/knowledge`），以 SVG 散点图展示向量片段的 PCA 二维投影，同色点来自同一文件。
- 支持按来源过滤、内容搜索、点击查看完整片段、删除单个片段或整个来源。
- 支持导入 `.txt` / `.md` 文档并向量化入库（同名文件自动替换旧片段）。

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | React 19、TypeScript 6 |
| 构建 | Vite 8 |
| UI | Ant Design 6、@ant-design/icons |
| Markdown | react-markdown + remark-gfm（表格 / 删除线 / 任务列表） |
| 图表 | 原生 SVG 手绘散点图（无图表库依赖） |
| 路由 | 极简 hash 路由（`#/knowledge`） |
| 代码规范 | ESLint 10 + typescript-eslint |

## 目录结构

```
.
├── index.html
├── vite.config.ts          # 开发服务器 + /api 代理配置
├── .env.example            # 后端地址示例配置
├── public/
└── src/
    ├── main.tsx            # 入口
    ├── Root.tsx            # hash 路由：对话页 / 知识库页
    ├── App.tsx             # 对话主界面（会话、流式、附件、拖拽）
    ├── types.ts            # 与后端 API 对应的类型定义
    ├── api/
    │   ├── chat.ts         # 对话 SSE、会话、附件接口
    │   └── knowledge.ts    # 知识库向量接口
    ├── components/
    │   ├── ChatMessage.tsx # 消息气泡（Markdown 渲染）
    │   └── ToolCallCard.tsx# 工具调用卡片
    └── pages/
        ├── KnowledgePage.tsx
        └── KnowledgePage.css
```

## 快速开始

### 环境要求

- Node.js **≥ 20**（Vite 8 要求）
- npm / pnpm / yarn 任选其一

### 安装与启动

```bash
npm install
npm run dev
```

打开 <http://localhost:5173>。开发服务器已将 `/api` 代理到后端 `http://localhost:8000`。

如需指向其他后端地址：

```bash
# .env.local
VITE_API_BASE=http://192.168.1.10:8000
```

### 构建与预览

```bash
npm run build     # tsc 类型检查 + 产物输出到 dist/
npm run preview   # 本地预览构建产物
npm run lint      # ESLint 检查
```

生产部署时需由 Nginx 等反向代理把 `/api` 转发到后端，并注意为 SSE 关闭缓冲（`proxy_buffering off;`）。

## 后端接口约定

前端依赖以下接口（同源 `/api` 前缀）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/chat` | 流式对话，返回 SSE |
| GET | `/api/v1/threads` | 会话列表 |
| GET | `/api/v1/threads/{id}/messages` | 会话历史消息（含中断态） |
| DELETE | `/api/v1/threads/{id}` | 删除会话 |
| POST | `/api/v1/attachments` | 上传对话附件 |
| GET | `/api/v1/attachments/{name}` | 获取附件内容 |
| GET | `/api/v1/knowledge/embeddings` | 向量片段 + PCA 坐标 |
| GET | `/api/v1/knowledge/embeddings/{id}` | 单个片段全文 |
| DELETE | `/api/v1/knowledge/embeddings/{id}` | 删除单个片段 |
| DELETE | `/api/v1/knowledge/sources` | 按来源删除全部片段 |
| POST | `/api/v1/knowledge/documents` | 上传文档并向量化 |

SSE 事件格式：

```
event: token
data: {"content": "片段"}

event: done
data: {"task_completed": true, "content": "...", "thread_id": "...", "awaiting_user": false}
```

完整字段定义见 [`src/types.ts`](src/types.ts)。
