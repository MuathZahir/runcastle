// runcastle.dev docs: the command blocks' system tabs and copy buttons. The
// pages read fine without it; this only adds the two conveniences.
;(() => {
  document.documentElement.classList.add('js')
  const KEY = 'runcastle-docs-os'
  const guess = /Win/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '') ? 'windows' : 'unix'
  let os = localStorage.getItem(KEY) ?? guess

  const show = () => {
    for (const tab of document.querySelectorAll('.doc-os button')) tab.setAttribute('aria-selected', String(tab.dataset.os === os))
    for (const line of document.querySelectorAll('.doc-cmd .doc-line[data-os]')) line.hidden = line.dataset.os !== os
  }

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.doc-os button')
    if (tab) {
      os = tab.dataset.os
      localStorage.setItem(KEY, os)
      show()
      return
    }
    const cp = e.target.closest('.doc-cp')
    if (cp) {
      const text = cp.closest('.doc-line').querySelector('code').textContent
      navigator.clipboard?.writeText(text).then(() => {
        cp.classList.add('done')
        cp.querySelector('.label').textContent = 'Copied'
        setTimeout(() => {
          cp.classList.remove('done')
          cp.querySelector('.label').textContent = 'Copy'
        }, 1600)
      })
    }
  })
  show()
})()
