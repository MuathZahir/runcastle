import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'

/**
 * The UI-states catalogue runcastle builds at review and shows on a feature's
 * page (docs/features/features-show-their-ui-states-as-stories, decision 11:
 * runcastle's machinery, so it lives under `.runcastle/`, never a root
 * `.storybook/`). Built by `.runcastle/stories.json`, never served by
 * `storybook dev`.
 *
 * The web app's own Vite config is reused whole — React, Tailwind, and whatever
 * it grows next — so a story compiles exactly as the app does. Its dev-server
 * proxy plays no part in a static build.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        viteConfigPath: fileURLToPath(new URL('../../apps/web/vite.config.ts', import.meta.url)),
      },
    },
  },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
}

export default config
