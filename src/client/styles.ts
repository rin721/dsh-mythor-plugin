/** One style node per mounted workbench; portal content uses the same module classes. */
export function mountStyles() {
  if (typeof __MYTHOR_CSS__ === 'undefined') return () => {}
  const element = document.createElement('style')
  element.dataset.mythorStyles = ''
  element.textContent = __MYTHOR_CSS__
  document.head.append(element)
  return () => element.remove()
}
