import { useState, useEffect } from 'react'
import { Landing } from './components/landing/Landing'
import { App }     from './components/app/App'

const LS_VIEW = '_av_view'

type View = 'landing' | 'app'

export function Root() {
  const [view, setView] = useState<View>(() =>
    (localStorage.getItem(LS_VIEW) as View) ?? 'landing'
  )

  useEffect(() => { localStorage.setItem(LS_VIEW, view) }, [view])

  if (view === 'app') return <App onBack={() => setView('landing')} />
  return (
    <Landing
      onLaunchApp={() => setView('app')}
      onAgents={() => { setView('app') }}
      onDocs={() => window.open('https://averisprotocol.xyz/llms.txt', '_blank')}
    />
  )
}
