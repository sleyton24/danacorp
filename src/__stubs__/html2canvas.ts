// Stub for html2canvas — not needed when using jspdf-autotable with `body:` data
// (only required when using the `html:` option to capture DOM elements)
export default function html2canvas(
  _element: HTMLElement,
  _options?: Record<string, unknown>,
): Promise<HTMLCanvasElement> {
  return Promise.resolve(document.createElement('canvas'));
}
