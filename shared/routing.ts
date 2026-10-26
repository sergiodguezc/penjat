export type Route = '/' | '/multijugador/' | '/aprendre/' | '/paraula-del-dia/' | '/com-es-juga/'

export const publicRoutes: readonly Route[] = ['/', '/multijugador/', '/aprendre/', '/paraula-del-dia/', '/com-es-juga/']

export function normalizeRoute(pathname: string): Route | null {
  const trimmed = pathname.replace(/\/+$/, '') || '/'
  const withoutLegacyLocale = trimmed === '/es'
    ? '/'
    : trimmed === '/es/como-jugar'
      ? '/com-es-juga'
    : trimmed.startsWith('/es/')
      ? trimmed.slice(3) || '/'
      : trimmed
  const candidate = withoutLegacyLocale === '/' ? '/' : `${withoutLegacyLocale}/`
  return publicRoutes.includes(candidate as Route) ? candidate as Route : null
}
