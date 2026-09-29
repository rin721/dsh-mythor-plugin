/** Bounded UTF-16 batches, preferring paragraph boundaries and never splitting a surrogate pair. */
export function splitMaterial(text: string, limit = 12000): string[] {
  const batches: string[] = []
  for (let offset = 0; offset < text.length; ) {
    let end = Math.min(text.length, offset + limit)
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n', end)
      if (paragraph > offset + limit / 2) end = paragraph + 1
      if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--
    }
    batches.push(text.slice(offset, end))
    offset = end
  }
  return batches
}
