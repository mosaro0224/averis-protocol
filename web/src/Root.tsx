import { useState, useEffect } from 'react'
import { Landing }     from './components/landing/Landing'
import { App }         from './components/app/App'
import { ScrollToTop } from './components/ui/ScrollToTop'

const LS_VIEW = '_av_view'

type View = 'landing' | 'app'

export function Root() {
  const [view, setView] = useState<View>(() =>
    (localStorage.getItem(LS_VIEW) as View) ?? 'landing'
  )

  useEffect(() => { localStorage.setItem(LS_VIEW, view) }, [view])

  return (
    <>
      {view === 'app'
        ? <App onBack={() => setView('landing')} />
        : <Landing onLaunchApp={() => setView('app')} />
      }
      <ScrollToTop />
    </>
  )
}
