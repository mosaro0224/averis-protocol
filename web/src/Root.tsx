import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Landing }       from './components/landing/Landing'
import { App }           from './components/app/App'
import { PassportShell } from './components/passport/PassportShell'
import { ScrollToTop }   from './components/ui/ScrollToTop'

export function Root() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/"         element={<Landing />} />
        <Route path="/finance"  element={<App />} />
        <Route path="/passport" element={<PassportShell />} />
        {/* legacy: any unknown path falls back to landing */}
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
