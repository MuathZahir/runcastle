/* runcastle.dev landing page behaviour.
 *
 * Everything here is IntersectionObserver or event driven. There is no scroll
 * listener and no rAF loop, so nothing runs per frame.
 *
 * Motion inventory, each justified:
 *   1. reveal on enter        -> hierarchy, brings the eye down the page in order
 *   2. pipeline rail draw     -> storytelling, the pipeline advancing left to right
 *   3. sticky stage swap      -> storytelling, the visual tracks the step being read
 *   4. nav hairline on scroll -> state transition, the bar has detached from the top
 *   5. copy button feedback   -> feedback, acknowledges the click
 */

(() => {
  'use strict'

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* ---- 1 + 2. reveal on enter -------------------------------------------- */
  const revealables = document.querySelectorAll('.reveal')

  if (reduced || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('is-in'))
  } else {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-in')
          revealObserver.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    )
    revealables.forEach((el) => revealObserver.observe(el))
  }

  /* ---- 3. sticky stage tracks the active step ---------------------------- */
  const steps = Array.from(document.querySelectorAll('.step'))
  const stagePanels = Array.from(document.querySelectorAll('#stage .stage-panel'))

  const setStage = (index) => {
    steps.forEach((step) => {
      step.classList.toggle('is-active', Number(step.dataset.stage) === index)
    })
    stagePanels.forEach((panel) => {
      panel.classList.toggle('is-shown', Number(panel.dataset.stage) === index)
    })
  }

  if (steps.length && stagePanels.length) {
    // Clicking a step is the accessible, keyboard-reachable path. It works
    // regardless of scroll position or reduced-motion preference.
    steps.forEach((step) => {
      step.addEventListener('click', () => setStage(Number(step.dataset.stage)))
      step.addEventListener('focus', () => setStage(Number(step.dataset.stage)))
    })

    // On top of that, scrolling through the steps advances the stage on its own.
    // A band across the middle of the viewport decides which step is "being
    // read", which is steadier than reacting to whichever step entered last.
    if (!reduced && 'IntersectionObserver' in window) {
      const stepObserver = new IntersectionObserver(
        (entries) => {
          const inBand = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
          if (inBand) setStage(Number(inBand.target.dataset.stage))
        },
        { rootMargin: '-42% 0px -42% 0px', threshold: 0 },
      )
      steps.forEach((step) => stepObserver.observe(step))
    }
  }

  /* ---- 3b. fit each product mock to its frame ---------------------------- */
  /* Every mock lays out at a fixed logical width (--rc-w) and is scaled to fit.
   * ResizeObserver keeps the scale exact as the column changes, which no amount
   * of media queries can do reliably because the frames live in columns of
   * different widths. The CSS default covers the no-JS case. */
  const frames = Array.from(document.querySelectorAll('.rc-frame:not(.is-natural)'))

  if (frames.length) {
    const fit = (frame) => {
      const logical = parseFloat(getComputedStyle(frame).getPropertyValue('--rc-w'))
      const available = frame.clientWidth
      if (!logical || !available) return
      // Never scale past 1: blowing a mock up past its design size looks wrong
      // even though it stays sharp.
      const scale = Math.min(available / logical, 1)
      frame.style.setProperty('--rc-s', String(scale))

      // Height from content, so a panel never carries dead space below itself.
      // scrollHeight is the pre-transform layout height, which is what we want
      // to scale.
      if (frame.classList.contains('is-autoheight')) {
        const app = frame.firstElementChild
        if (app) frame.style.height = `${Math.round(app.scrollHeight * scale)}px`
      }
    }

    if ('ResizeObserver' in window) {
      const frameObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => fit(entry.target))
      })
      frames.forEach((frame) => {
        fit(frame)
        frameObserver.observe(frame)
      })
    } else {
      frames.forEach(fit)
    }
  }

  /* ---- 4. nav gains a hairline once it detaches from the top ------------- */
  const nav = document.getElementById('nav')
  if (nav && 'IntersectionObserver' in window) {
    // A zero-height sentinel at the very top of the document. Watching it is
    // free; watching scroll position is not.
    const sentinel = document.createElement('div')
    sentinel.setAttribute('aria-hidden', 'true')
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;'
    document.body.prepend(sentinel)

    new IntersectionObserver(
      ([entry]) => nav.classList.toggle('is-stuck', !entry.isIntersecting),
      { threshold: 0 },
    ).observe(sentinel)
  }

  /* ---- 5. copy to clipboard --------------------------------------------- */
  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 6 9 17l-5-5"/></svg>'

  document.querySelectorAll('.copy').forEach((button) => {
    const original = button.innerHTML

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

      button.classList.add('is-done')
      button.innerHTML = CHECK
      button.setAttribute('aria-label', 'Copied')

      window.setTimeout(() => {
        button.classList.remove('is-done')
        button.innerHTML = original
        button.setAttribute('aria-label', 'Copy command')
      }, 1600)
    })
  })
})()
