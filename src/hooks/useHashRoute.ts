import { useEffect, useState } from 'react'
import { parseHash, type RouteState } from '../config/hashRoute'

export function useHashRoute(): RouteState {
  const [route, setRoute] = useState<RouteState>(() => parseHash(window.location.hash))

  useEffect(() => {
    const sync = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return route
}
