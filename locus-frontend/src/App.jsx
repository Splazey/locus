import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { GraphCanvas } from './components/GraphCanvas'
import { RightSidebar } from './components/RightSidebar'
import { HomeScreen } from './components/HomeScreen'
import { LoadingScreen } from './components/LoadingScreen'
import { useGraphStore } from './store/useGraphStore'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

function SaveChangesModal() {
  const showExitModal = useGraphStore((s) => s.showExitModal)
  if (!showExitModal) return null

  const store = useGraphStore.getState()

  async function handleSaveAndExit() {
    try {
      const meta = await window.electronAPI.saveCodebase(store.buildSavePayload())
      useGraphStore.getState().setCurrentSave(meta)
    } catch (e) {
      useGraphStore.getState().setError(`Save failed: ${e.message}`)
      useGraphStore.getState().setShowExitModal(false)
      return
    }
    useGraphStore.getState().goHome()
  }

  return (
    <div className="modal-backdrop" onClick={() => store.setShowExitModal(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Unsaved changes</h3>
        <p className="modal__body">
          This visualization has changes that haven&apos;t been saved. Save them
          before going back to the home screen?
        </p>
        <div className="modal__actions">
          <button className="modal__btn modal__btn--primary" onClick={handleSaveAndExit}>
            Save changes
          </button>
          <button className="modal__btn modal__btn--danger" onClick={() => store.goHome()}>
            Don&apos;t save
          </button>
          <button className="modal__btn" onClick={() => store.setShowExitModal(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const screen = useGraphStore((s) => s.screen)

  // Forward backend analysis progress events into the store (once)
  useEffect(() => {
    if (!isElectron || !window.electronAPI.onAnalysisProgress) return
    return window.electronAPI.onAnalysisProgress((payload) => {
      useGraphStore.getState().setProgress(payload)
    })
  }, [])

  if (screen === 'home')    return <HomeScreen />
  if (screen === 'loading') return <LoadingScreen />

  return (
    <div className="app-layout app-layout--fade-in">
      <Sidebar />
      <GraphCanvas />
      <RightSidebar />
      <SaveChangesModal />
    </div>
  )
}
