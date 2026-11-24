import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// React Flow and react-resizable-panels need browser APIs that jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

class DOMMatrixStub {
  m22 = 1
}
;(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= DOMMatrixStub

Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia
