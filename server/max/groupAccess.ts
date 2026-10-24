/** Обычные сообщения группы приходят боту только с правом администратора read_all_messages. */
export function groupCanReadMessages(permissions: readonly string[] | null | undefined): boolean {
  return Array.isArray(permissions) && permissions.includes('read_all_messages')
}
