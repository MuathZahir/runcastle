import { useRoute } from './lib/router'
import { FeaturePage } from './pages/FeaturePage'
import { Home } from './pages/Home'

export function App() {
  const route = useRoute()
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          runcastle
        </a>
        <span className="topbar-sub mono">local run · observe · review</span>
      </header>
      <main className="container">
        {route.name === 'home' ? (
          <Home />
        ) : (
          // Key by id so per-feature state (event log) resets on navigation.
          <FeaturePage key={route.id} id={route.id} />
        )}
      </main>
    </div>
  )
}
