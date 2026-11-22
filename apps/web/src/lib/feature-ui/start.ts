import { INVOLVEMENT_LABEL, INVOLVEMENT_NAME, startPurposeFor, type Involvement } from '@runcastle/core'

/**
 * What a feature's lead does once Start launches it: its level picks it
 * (`startPurposeFor`), as the one Start button does. At "Everything" it opens and asks first;
 * below it, it plans and builds by itself.
 */
export function startWhat(level: Involvement): string {
  return startPurposeFor(level)
    ? 'The agent plans and builds it, stopping only where your level says.'
    : 'The agent reads the brief, looks through the code and asks you first.'
}

/** The line under a not-started feature's Start: its level, then what the lead will do at it. */
export function startHint(level: Involvement): string {
  return `${INVOLVEMENT_NAME}: ${INVOLVEMENT_LABEL[level]}. ${startWhat(level)}`
}
