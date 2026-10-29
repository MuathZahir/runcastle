import { StrictMode, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import {
  Button,
  cx,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Disclosure,
  IconButton,
  List,
  ListRow,
  NavItem,
  SplitButton,
  StatusDot,
} from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { Tabs } from '../src/ui/tabs'
import { Field, TextField } from '../src/ui/field'
import { SegmentedControl, Switch } from '../src/ui/choice'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '../src/ui/dropdown-menu'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, SELECT_FIELD } from '../src/ui/select'
import {
  IconActivity,
  IconArchive,
  IconDoc,
  IconGitMerge,
  IconList,
  IconMessage,
  IconMonitor,
  IconMoon,
  IconMore,
  IconPanelRight,
  IconPlay,
  IconPlus,
  IconSettings,
  IconSun,
  IconTrash,
} from '../src/icons'
import { applyStoredTheme, useTheme } from '../src/lib/theme'

/**
 * The shared building blocks in the look this feature brings from the sidebar
 * (docs/features/the-whole-app-matches-the-sidebar): buttons, fields, tabs,
 * rows, a long menu and a dialog — the real primitives, on sample words. The
 * long menu is the scenarios dropdown's shape with thirty scenarios, to show
 * the height cap. A dead end on purpose: nothing here acts.
 */

applyStoredTheme()

const noop = () => {}

type State = 'blocks' | 'menu' | 'select' | 'dialog'
const STATES: { key: State; label: string }[] = [
  { key: 'blocks', label: 'Building blocks' },
  { key: 'menu', label: 'Long menu' },
  { key: 'select', label: 'Long select' },
  { key: 'dialog', label: 'Dialog' },
]

const SCENARIOS = [
  'Feature at review',
  'Fresh project, nothing prepared',
  'Busy project, three burns',
  'A failed round waiting on you',
  'Merge conflict on the integration branch',
  'Drive with notes and screenshots',
  'Backlog with twelve drafts',
  'Shipped feature with outcome',
  'Orchestrator waiting on two notes',
  'Ticket stuck after two retries',
  'Long chat with tool calls',
  'Design server running',
  'Preparation half done',
  'Review with four findings',
  'Empty project',
  'Archived feature',
  'Two drives at once',
  'Sandbox down',
  'Update available',
  'Every model annotated',
  'Codex as the runtime',
  'Scenario chat open',
  'A feature that depends on two others',
  'Plan preview with designs',
  'First run, no git identity',
  'Notes inbox overflowing',
  'Ticket with a long digest',
  'Round three of five',
  'Dark theme, narrow window',
  'Light theme, wide window',
]

const MODELS = Array.from({ length: 24 }, (_, i) =>
  i < 3 ? ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'][i]! : `claude-older-model-${i}`,
)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  )
}

function Blocks() {
  const [tab, setTab] = useState('general')
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')
  const [on, setOn] = useState(true)
  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-8 pt-12 pb-16">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-xl font-semibold tracking-tight text-text">Building blocks</h1>
        <p className="m-0 text-sm text-text-tertiary">Every screen is drawn from these. They now share the sidebar's material.</p>
      </div>
      <Tabs
        items={[
          { id: 'general', label: 'General', icon: <IconSettings /> },
          { id: 'models', label: 'Models', icon: <IconActivity /> },
          { id: 'sandbox', label: 'Sandbox', icon: <IconMonitor /> },
        ]}
        value={tab}
        onChange={setTab}
        label="Settings"
      />
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<IconPlay />}>
            Start test drive
          </Button>
          <Button icon={<IconPlus />}>New chat</Button>
          <Button variant="ghost" icon={<IconDoc />}>
            Open spec
          </Button>
          <Button variant="danger-ghost" icon={<IconTrash />}>
            Delete
          </Button>
          <SplitButton icon={<IconPlay />} onClick={noop} menuLabel="Pick a scenario" menu={<MenuItems count={4} />}>
            Test drive
          </SplitButton>
          <IconButton label="More" icon={<IconMore />} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>
      <Section title="Fields">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Dev command">
            <TextField defaultValue="bun run dev" className="font-mono" />
          </Field>
          <Field label="Model">
            <Select defaultValue="claude-opus-5-5">
              <SelectTrigger className={cx(SELECT_FIELD, 'w-full')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.slice(0, 3).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-6">
          <SegmentedControl
            label="Theme"
            value={theme}
            onChange={setTheme}
            items={[
              { value: 'dark', label: 'Dark', icon: <IconMoon /> },
              { value: 'light', label: 'Light', icon: <IconSun /> },
              { value: 'system', label: 'System', icon: <IconMonitor /> },
            ]}
          />
          <Switch checked={on} onChange={setOn} label="Notify me when a run needs me" />
        </div>
      </Section>
      <Section title="Rows">
        <List>
          <ListRow leading={<StatusDot tone="warning" />} title="Cut the UI work into seven features" meta="waiting for you" onClick={noop} active />
          <ListRow leading={<IconMessage />} title="Why did the burn of #14 stall overnight?" meta="22h" onClick={noop} />
          <ListRow
            leading={<IconMessage />}
            title="Plan the changelog release flow"
            description="feature/changelog-file-per-release"
            meta="2d"
            onClick={noop}
          />
          <ListRow leading={<IconMessage />} title="Triage the notes from Tuesday’s drive" meta="6d" onClick={noop} />
        </List>
        <div className="flex w-64 flex-col gap-1 rounded-lg bg-canvas p-2">
          <NavItem icon={<IconList />} label="Backlog" meta="3" onClick={noop} />
          <NavItem icon={<IconGitMerge />} label="Shipped" meta="12" onClick={noop} active />
          <NavItem icon={<IconArchive />} label="Archived" meta="3" onClick={noop} />
        </div>
      </Section>
      <Disclosure title="Drive setup" aside="project-drive · main">
        <p className="m-0 text-sm text-text-secondary">What a drive runs before it opens the app, and what it runs to stop.</p>
      </Disclosure>
    </div>
  )
}

function MenuItems({ count = SCENARIOS.length }: { count?: number }) {
  return (
    <>
      <DropdownMenuLabel>Scenarios</DropdownMenuLabel>
      {SCENARIOS.slice(0, count).map((s) => (
        <DropdownMenuItem key={s} icon={<IconPlay />} onSelect={noop}>
          {s}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem icon={<IconPlus />} onSelect={noop}>
        New scenario
      </DropdownMenuItem>
    </>
  )
}

/** A state behind a click: open it the way a person would, once it has mounted. */
function useOpen(selector: string, event: 'pointerdown' | 'click') {
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(selector)
      if (event === 'click') el?.click()
      else el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }))
    }, 300)
    return () => clearTimeout(t)
  }, [selector, event])
}

function LongMenu() {
  useOpen('[aria-label="Pick a scenario"]', 'pointerdown')
  return (
    <div className="flex justify-end px-6 pt-4">
      <SplitButton variant="primary" icon={<IconPlay />} onClick={noop} menuLabel="Pick a scenario" menu={<MenuItems />}>
        Test drive
      </SplitButton>
    </div>
  )
}

function LongSelect() {
  useOpen('[data-kit-select]', 'pointerdown')
  return (
    <div className="mx-auto w-full max-w-(--content-max) px-8 pt-12">
      <Field label="Model for all pending tickets">
        <Select defaultValue="claude-sonnet-5-5">
          <SelectTrigger data-kit-select="" className={cx(SELECT_FIELD, 'w-72 font-mono')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="font-mono">
            <SelectGroup>
              <SelectLabel>Annotated</SelectLabel>
              {MODELS.slice(0, 3).map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Older models</SelectLabel>
              {MODELS.slice(3).map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

function DialogState() {
  return (
    <>
      <Blocks />
      <Dialog open onClose={noop} labelledBy="kit-dialog">
        <DialogHeader
          id="kit-dialog"
          title="Merge and ship"
          description="Merges feature/changelog-file-per-release into main and ends its sessions."
          onClose={noop}
        />
        <DialogBody>
          <Field label="Merge message">
            <TextField defaultValue="Merge feature: Changelog file per release" />
          </Field>
        </DialogBody>
        <DialogFooter start="3 commits ahead of main">
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary" icon={<IconGitMerge />}>
            Merge and ship
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}

function Page() {
  const [state, setState] = useState<State>('blocks')
  const theme = useTheme()
  return (
    <div className="flex h-screen flex-col bg-canvas text-text">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-subtle px-3 text-sm">
        <span className="mr-2 text-text-tertiary">State</span>
        {STATES.map((s) => (
          <Button key={s.key} size="sm" variant="ghost" aria-pressed={state === s.key} onClick={() => setState(s.key)}>
            {s.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" aria-pressed={theme.resolved === 'light'} onClick={theme.toggle}>
          Light theme
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 p-2 pl-0">
        <div className="w-2 shrink-0" />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <PageTopbar
            crumbs={[{ label: 'runcastle' }, { label: 'Settings' }]}
            actions={<IconButton label="Toggle panel" icon={<IconPanelRight />} />}
          />
          <div className="min-h-0 flex-1 overflow-y-auto" key={state}>
            {state === 'blocks' && <Blocks />}
            {state === 'menu' && <LongMenu />}
            {state === 'select' && <LongSelect />}
            {state === 'dialog' && <DialogState />}
          </div>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <Page />
    </TooltipProvider>
  </StrictMode>,
)
