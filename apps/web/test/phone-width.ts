import { vi } from 'vitest'

/**
 * Renders what follows at a phone's width or a desktop's: `useIsPhone` reads
 * `matchMedia`, the browser's boundary, so a tier-2 test stubs that and
 * nothing of the app's. Undo it with `vi.unstubAllGlobals()`.
 */
export function atWidth(phone: boolean): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: phone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}
