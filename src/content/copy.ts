/** Тексты-заглушки. Меняются здесь, без правки компонентов. Факты не выдуманы. */
export const COPY = {
  pricePending: 'Цена уточняется',
  valuePending: 'Уточняется по паспорту',
  textPending: 'Текст будет добавлен после согласования с заказчиком.',
  linkPending: 'Ссылка будет добавлена',
  filePending: 'Файл будет добавлен',
  photoPending: 'Фото будет добавлено',
  datePending: 'Дата уточняется',
  speakerPending: 'Спикер уточняется',
  disclaimer: 'Не является лекарственным средством. Перед применением нужна консультация со специалистом.',
  supplementNote: 'Название и состав приведены по данным упаковки. Подробности — по данным производителя.',
  deviceNote: 'Описание и характеристики будут добавлены по официальным материалам компании.',
  aboutLead:
    'HALOS — магазин приборов для здоровья и БАДов компании-производителя. История и факты о компании будут добавлены по официальным материалам.',
  consentLabel: 'Я согласен(на) на обработку персональных данных в соответствии с Политикой конфиденциальности',
  formUnavailable: 'Форма пока не подключена к серверу. Напишите в Telegram или MAX, когда ссылки появятся.',
  emptyCatalog: 'По этим условиям товаров нет.',
  resetFilters: 'Сбросить фильтры',
} as const

export const TRUST = [
  { title: 'Консультация перед покупкой', note: 'Ответим в мессенджере' },
  { title: 'Связь в Telegram и MAX', note: 'Удобный способ задать вопрос' },
  { title: 'Оригинальная продукция', note: 'Товары производителей из каталога' },
  { title: 'Вебинары о продукции', note: 'Даты публикуются после подтверждения' },
] as const

export const FAQ = [
  { id: 'choose', q: 'Как выбрать прибор?', a: COPY.textPending },
  { id: 'order', q: 'Как оформить заказ?', a: COPY.textPending },
  { id: 'consult', q: 'Как получить консультацию?', a: COPY.textPending },
  { id: 'docs', q: 'Где посмотреть документы на продукцию?', a: COPY.textPending },
  { id: 'delivery', q: 'Какие способы доставки доступны?', a: COPY.textPending },
] as const

export const DOCUMENTS = [
  { id: 'declaration', title: 'Декларация соответствия' },
  { id: 'certificate', title: 'Сертификат' },
  { id: 'manual', title: 'Инструкция' },
] as const

export const CATEGORY_LABELS = {
  all: 'Все товары',
  supplements: 'БАДы',
  devices: 'Приборы',
  care: 'Уход',
  bath: 'Для ванны',
  drinks: 'Напитки',
  home: 'Для дома',
  accessories: 'Аксессуары',
} as const

export const BRAND_LABELS = {
  chan: 'Чан Шэн Чжэ',
  era: 'ЭРА БОТАНИКА',
  jilanzhi: 'JILANZHI',
  silkway: 'SILKWAY',
  jeudao: 'JEUDAO',
  halos: 'HALOS',
} as const

export const FORM_LABELS = {
  capsules: 'Капсулы',
  tablets: 'Таблетки',
  powder: 'Порошок / напиток',
  oil: 'Масло',
} as const
