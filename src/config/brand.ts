/**
 * Единственное место путей и подписи логотипа SILKWAY.
 * Высота задаётся токенами --logo-header-height и --logo-footer-height.
 * Файл увеличен из маленького оригинала: на экране не выше 160px, без фильтров резкости.
 */
export const BRAND = {
  name: 'SILKWAY',
  homeLabel: 'SILKWAY — на главную',
  logo: {
    src: '/brand/logo-silkway.png',
    alt: 'SILKWAY',
  },
  mark: {
    src: '/brand/logo-silkway-mark.png',
  },
  icons: {
    favicon32: '/brand/favicon-32.png',
    appleTouch: '/brand/apple-touch-icon.png',
    icon512: '/brand/icon-512.png',
    og: '/brand/og-logo.png',
  },
} as const
