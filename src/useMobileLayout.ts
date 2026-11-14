import { useSyncExternalStore } from 'react'

const mobileLayout = '(max-width: 680px)'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(mobileLayout)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useMobileLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(mobileLayout).matches, () => false)
}
