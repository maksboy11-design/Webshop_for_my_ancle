/**
 * Один общий «фокус» воспроизведения на странице: запуск одного видео ставит на паузу остальные,
 * уход со страницы (вкладка скрыта / pagehide) ставит на паузу всё. Ставится один раз на документ.
 */
let focusInstalled = false
export function installVideoFocus(doc: Document = document) {
  if (focusInstalled) return
  focusInstalled = true
  doc.addEventListener(
    'play',
    (e) => {
      const t = e.target
      if (!(t instanceof HTMLMediaElement)) return
      doc.querySelectorAll('video, audio').forEach((v) => {
        if (v !== t && !(v as HTMLMediaElement).paused) (v as HTMLMediaElement).pause()
      })
    },
    true,
  )
  const pauseAll = () => doc.querySelectorAll('video, audio').forEach((v) => (v as HTMLMediaElement).pause())
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') pauseAll()
  })
  window.addEventListener('pagehide', pauseAll)
}
