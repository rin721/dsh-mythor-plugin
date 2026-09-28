import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(cleanup)
// Geometry APIs absent in jsdom; real positioning is verified in Harness Web.
HTMLElement.prototype.scrollIntoView = () => {}
HTMLElement.prototype.hasPointerCapture = () => false
HTMLElement.prototype.setPointerCapture = () => {}
HTMLElement.prototype.releasePointerCapture = () => {}
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
