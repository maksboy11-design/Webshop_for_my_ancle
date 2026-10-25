/** Цена товара: две равноправные величины — рубли и PV (баллы). */
export interface ProductPrice {
  rub: number
  pv: number
}

/** Курс прайс-листа: 1 PV = 84 ₽. */
export const PV_TO_RUB = 84

const NBSP = '\u00A0'
const RUBLE = '\u20BD'

/** Тысячи через неразрывный пробел (U+00A0), в том числе для четырёхзначных: 3 528, 4 200. */
export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** «3 528 ₽» — неразрывные пробелы между разрядами и перед знаком рубля. */
export function formatRub(value: number): string {
  return `${formatNumber(value)}${NBSP}${RUBLE}`
}

/** «42 PV», «4 200 PV» — тот же разделитель тысяч, что и в рублях. */
export function formatPv(value: number): string {
  return `${formatNumber(value)}${NBSP}PV`
}

/** Текст для скринридера и тестов: «3 528 ₽ / 42 PV». */
export function formatPrice(price: ProductPrice): string {
  return `${formatRub(price.rub)} / ${formatPv(price.pv)}`
}
