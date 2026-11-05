export const SIDEBAR_COOKIE_NAME = "sidebar_state"

export function readSidebarOpenFromCookie(
  cookies: string = typeof document !== "undefined" ? document.cookie : ""
): boolean | undefined {
  const match = cookies.match(
    new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE_NAME}=(true|false)(?:;|$)`)
  )
  if (!match) {
    return undefined
  }
  return match[1] === "true"
}
