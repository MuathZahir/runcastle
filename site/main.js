/* runcastle.dev landing page behaviour.
 *
 * Everything here is event driven. There is no scroll listener, no observer
 * and no rAF loop, so nothing runs per frame and nothing runs on scroll.
 *
 * What moves, each justified (the motion itself is CSS, see MOTION in
 * styles.css):
 *   1. hero entrance        -> hierarchy, the eye lands on the headline first
 *   2. pipeline panel swap  -> state transition, the panel follows the tile
 *   3. copy button feedback -> feedback, acknowledges the click
 *
 * The page reads whole without this file: the pipeline shows all six panels
 * stacked, the commands can be selected by hand, and the film link goes to the
 * film.
 */

(() => {
  'use strict'

  /* ---- 1. the pipeline walkthrough --------------------------------------- */
  /* Six tiles, six panels. Pressing a tile shows its panel and fills the bars
   * up to and including it, so the row reads as progress through the pipeline
   * rather than as six unrelated tabs. */
  const phases = Array.from(document.querySelectorAll('.phase'))
  const panels = Array.from(document.querySelectorAll('.walk-panel'))

  const setStage = (index) => {
    phases.forEach((phase) => {
      const stage = Number(phase.dataset.stage)
      phase.classList.toggle('is-reached', stage <= index)
      phase.setAttribute('aria-pressed', String(stage === index))
    })
    panels.forEach((panel) => {
      panel.classList.toggle('is-shown', Number(panel.dataset.stage) === index)
    })
  }

  phases.forEach((phase) => {
    phase.addEventListener('click', () => setStage(Number(phase.dataset.stage)))
  })

  /* ---- 2. copy to clipboard ---------------------------------------------- */
  document.querySelectorAll('.copy').forEach((button) => {
    const label = button.querySelector('span')
    let reset = 0

    button.addEventListener('click', async () => {
      const text = button.dataset.copy
      if (!text) return

      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Clipboard API needs a secure context and can be refused outright.
        // Fall back to a hidden textarea so the button still does its job.
        const scratch = document.createElement('textarea')
        scratch.value = text
        scratch.setAttribute('readonly', '')
        scratch.style.cssText = 'position:fixed;top:-1000px;opacity:0;'
        document.body.appendChild(scratch)
        scratch.select()
        try {
          document.execCommand('copy')
        } catch {
          // Nothing left to try. Leave the command on screen to select by hand.
          document.body.removeChild(scratch)
          return
        }
        document.body.removeChild(scratch)
      }

      if (!label) return
      label.textContent = 'Copied'
      window.clearTimeout(reset)
      reset = window.setTimeout(() => {
        label.textContent = 'Copy'
      }, 1600)
    })
  })

  /* ---- 3. the film -------------------------------------------------------- */
  /* The hero's second button is a plain link to the film, which is what it
   * stays without JS or without <dialog>. Here it opens the film in a modal
   * instead and starts it; closing the modal, by the button, Escape or a click
   * on the backdrop, pauses it so it never plays on behind the page. */
  const film = document.getElementById('film')
  const video = film ? film.querySelector('video') : null

  if (film && video && typeof film.showModal === 'function') {
    document.querySelectorAll('[data-film-open]').forEach((opener) => {
      opener.addEventListener('click', (event) => {
        event.preventDefault()
        film.showModal()
        // Refused autoplay is fine: the controls are right there.
        const started = video.play()
        if (started) started.catch(() => {})
      })
    })

    film.querySelectorAll('[data-film-close]').forEach((closer) => {
      closer.addEventListener('click', () => film.close())
    })

    // The dialog's own box is filled edge to edge by its children, so a click
    // whose target is the dialog itself can only have landed on the backdrop.
    film.addEventListener('click', (event) => {
      if (event.target === film) film.close()
    })

    film.addEventListener('close', () => video.pause())
  }
})()
