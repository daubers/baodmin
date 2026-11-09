const MASK = '••••'

/**
 * A connection URL safe to put on screen. Templated passwords ("{{password}}", which OpenBao fills in itself) are
 * kept, but a literal one typed into the URL ("user:secret@host", "?password=secret") is hidden.
 */
export function maskConnectionUrl(url: string): string {
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/[^:@/\s]*:)([^@/\s]*)(@)/i, (m, head: string, pw: string, at: string) =>
      pw.includes('{{') ? m : `${head}${MASK}${at}`,
    )
    .replace(/([?&;\s]password=)([^&;\s]*)/gi, (m, head: string, pw: string) => (pw.includes('{{') ? m : `${head}${MASK}`))
}
