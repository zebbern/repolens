import type { MutableRefObject } from 'react'

/** Trigger a file download from a Blob. */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Export a Mermaid SVG element as an .svg file. */
export function exportSvg(svgEl: SVGSVGElement, diagramType: string) {
  const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml' })
  triggerDownload(blob, `${diagramType}-diagram.svg`)
}

/** Export a Mermaid SVG element as a high-DPI .png file. */
export function exportPng(svgEl: SVGSVGElement, diagramType: string) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = new window.Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    canvas.width = img.width * 2
    canvas.height = img.height * 2
    ctx.scale(2, 2)
    ctx.drawImage(img, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      triggerDownload(blob, `${diagramType}-diagram.png`)
    })
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svgEl))))
}
