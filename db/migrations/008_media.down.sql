-- Откат 008: удаляет метаданные медиатеки и связи. Сами файлы в Blob НЕ удаляются. Автоматически не запускается.
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS media;
