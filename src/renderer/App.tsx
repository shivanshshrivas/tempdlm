import { useEffect } from 'react'
import { useQueueStore } from './store/useQueueStore'

export default function App() {
  const { setItems, addItem, removeItem, setLoading } = useQueueStore()

  // ── Bootstrap: load queue and subscribe to main-process events ────────────
  useEffect(() => {
    setLoading(true)
    window.tempdlm.getQueue().then((queue) => {
      setItems(queue)
      setLoading(false)
    })

    const unsubs = [
      window.tempdlm.onFileNew(addItem),
      window.tempdlm.onFileDeleted(removeItem),
      window.tempdlm.onQueueUpdated(setItems),
    ]

    return () => unsubs.forEach((fn) => fn())
  }, [])

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100 font-sans">
      {/* Placeholder — real views come next */}
      <div className="m-auto text-center space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">TempDLM</h1>
        <p className="text-neutral-400 text-sm">Temporary Download Manager</p>
        <p className="text-neutral-600 text-xs mt-4">
          App shell loaded — implementation in progress
        </p>
      </div>
    </div>
  )
}
