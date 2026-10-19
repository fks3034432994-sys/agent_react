import { useEffect, useState } from 'react'
import App from './App'
import KnowledgePage from './pages/KnowledgePage'

/** 极简 hash 路由：#/knowledge 打开可视化页，其余显示对话主页 */
export default function Root() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.startsWith('#/knowledge') ? <KnowledgePage /> : <App />
}
