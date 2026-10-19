import type { Meta, StoryObj } from '@storybook/react-vite'
import { DrivePrerequisitesNotice } from '../../../apps/web/src/components/review/DrivePrerequisitesNotice'

/** A machine that cannot record a walkthrough: only reached on a host missing drive pieces. */
const meta = {
  title: 'Review/DrivePrerequisitesNotice',
  component: DrivePrerequisitesNotice,
  args: {
    missing: [
      {
        piece: 'ffmpeg',
        reason: "`ffmpeg` is not on this machine's PATH, so a drive cannot be recorded",
        notice: 'ffmpeg not installed — install it and restart runcastle',
      },
      {
        piece: 'dev-command',
        reason: 'this project has no dev command configured, so a drive has no app to boot',
        notice: "this project has no dev command — set one in the project's test drive setup",
      },
    ],
  },
} satisfies Meta<typeof DrivePrerequisitesNotice>

export default meta
type Story = StoryObj<typeof meta>

export const MissingPieces: Story = {}
