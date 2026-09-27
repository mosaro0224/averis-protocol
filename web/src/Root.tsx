import { useState, useEffect } from 'react'
import { Landing }       from './components/landing/Landing'
import { App }           from './components/app/App'
import { PassportShell } from './components/passport/PassportShell'
import { ScrollToTop }   from './components/ui/ScrollToTop'

const LS_VIEW = '_av_view'

type View = 'landing' | 'app' | 'passport'

export function Root() {
  const [view, setView] = useState<View>(() =>
    (localStorage.getItem(LS_VIEW) as View) ?? 'landing'
  )

  useEffect(() => { localStorage.setItem(LS_VIEW, view) }, [view])

  if (view === 'app') {
    return (
      <>
        <App onBack={() => setView('landing')} onPassport={() => setView('passport')} />
        <ScrollToTop />
      </>
    )
  }

  if (view === 'passport') {
    return (
      <>
        <PassportShell onBack={() => setView('landing')} />
        <ScrollToTop />
      </>
    )
  }

  return (
    <>
      <Landing
        onLaunchApp={() => setView('app')}
        onLaunchPassport={() => setView('passport')}
      />
      <ScrollToTop />
    </>
  )
}
