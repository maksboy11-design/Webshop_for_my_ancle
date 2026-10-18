import type { SVGProps } from 'react'

/** Инлайновые SVG-иконки (stroke = currentColor), декоративные: aria-hidden. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number | string }

function Svg({ size = '1.5rem', children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
)

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.8 20c.9-3.7 3.7-5.6 7.2-5.6s6.300 1.900 7.200 5.600" />
  </Svg>
)

export const CartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 4.5h2.2l1.900 10.100h9.600l1.800-7.400H7" />
    <circle cx="9.500" cy="19" r="1.300" />
    <circle cx="16.500" cy="19" r="1.300" />
  </Svg>
)

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
)

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.500 12h14M13 6l6 6-6 6" />
  </Svg>
)

export const DropIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.500c3.400 4.300 5.500 7.200 5.500 10a5.500 5.500 0 0 1-11 0c0-2.800 2.100-5.700 5.500-10Z" />
    <path d="M9.500 14.500a2.600 2.600 0 0 0 2 2.300" />
  </Svg>
)

export const LeafIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19c-.5-8 3.800-13.500 14-14 .5 9-4.500 14.500-14 14Z" />
    <path d="M5 19c3-4.500 6-7.500 9.500-9.500" />
  </Svg>
)

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11.200 12 4.500l8 6.700" />
    <path d="M6 10v9.500h12V10" />
    <path d="M10 19.500v-5h4v5" />
  </Svg>
)

export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19.500s-7-4.300-7-9.700A3.900 3.900 0 0 1 12 7.600a3.900 3.900 0 0 1 7 2.200c0 5.400-7 9.700-7 9.700Z" />
  </Svg>
)
