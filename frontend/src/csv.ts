export type CsvCell = string | number | boolean | null | undefined

function csvCell(value: CsvCell): string {
  if (value == null) return ''
  let text = String(value)
  // Prevent spreadsheet programs from interpreting exported text as a formula.
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const contents = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${contents}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function csvFilename(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'fulltime-local'
}
