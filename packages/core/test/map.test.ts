import { describe, expect, it } from 'vitest'
import {
  catalogueDependsOn,
  groupMap,
  MainCatalogueAttempt,
  MainCatalogueRecord,
  MAP_UNGROUPED,
  mapNameKey,
  MapModel,
  sharedStoryFiles,
  touchesCatalogue,
  type MapGroupSkeleton,
} from '../src/map'
import { isPageStory, PreviewStats, StoryIndex, type StoryIndexEntry } from '../src/stories'

const story = (title: string, name: string, file: string): StoryIndexEntry => ({
  id: `${title.toLowerCase().replace(/\//g, '-')}--${name.toLowerCase()}`,
  title,
  name,
  importPath: `./src/${file}`,
  type: 'story',
})

/** A page story: its file sits under `.runcastle/stories/pages/`. */
const page = (title: string, name: string, file: string): StoryIndexEntry => ({
  id: `${title.toLowerCase().replace(/\//g, '-')}--${name.toLowerCase().replace(/\W+/g, '-')}`,
  title,
  name,
  importPath: `./.runcastle/stories/pages/${file}`,
  type: 'story',
})

const scenario = (path: string, hasCall = false) => ({
  file: `.runcastle/scenarios/${path}`,
  hasCall,
})

/** `id: name` per group, in order, with children marked by their parent. */
const outline = (groups: MapGroupSkeleton[]): string[] =>
  groups.map((g) => `${g.parentId ? '  ' : ''}${g.id}: ${g.name}`)

describe('sharedStoryFiles', () => {
  const reach = (entries: Record<string, string[]>): Map<string, Set<string>> =>
    new Map(Object.entries(entries).map(([file, stories]) => [file, new Set(stories)]))
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i}.stories.tsx`)
  const noImporters = new Map<string, Set<string>>()
  const importedBy = (entries: Record<string, string[]>): Map<string, Set<string>> =>
    new Map(Object.entries(entries).map(([file, by]) => [file, new Set(by)]))

  it('shares a file reached by more than a quarter of the stories', () => {
    const shared = sharedStoryFiles(
      reach({ 'theme.ts': names(8), 'helper.ts': names(2) }),
      10,
      noImporters,
    )
    expect([...shared]).toEqual(['theme.ts'])
  })

  it('needs at least 3 stories, however small the catalogue', () => {
    expect(sharedStoryFiles(reach({ 'helper.ts': names(2) }), 6, noImporters).size).toBe(0)
    expect(sharedStoryFiles(reach({ 'helper.ts': names(3) }), 6, noImporters).size).toBe(1)
  })

  it('needs more than a quarter, not exactly a quarter', () => {
    expect(sharedStoryFiles(reach({ 'helper.ts': names(3) }), 12, noImporters).size).toBe(0)
  })

  it('shares a hub two stories reach when 3 modules import it, as a barrel', () => {
    const importers = importedBy({
      'feature-ui.ts': ['ConflictCard.tsx', 'ReviewBody.tsx', 'NoteRow.tsx'],
      'ConflictCard.tsx': ['s0.stories.tsx', 'ReviewBody.tsx'],
    })
    const shared = sharedStoryFiles(
      reach({ 'feature-ui.ts': names(2), 'ConflictCard.tsx': names(2) }),
      8,
      importers,
    )
    expect([...shared]).toEqual(['feature-ui.ts'])
  })

  it('never makes a hub of a file only one story reaches', () => {
    const importers = importedBy({ 'own-helper.ts': ['a.tsx', 'b.tsx', 'c.tsx'] })
    expect(sharedStoryFiles(reach({ 'own-helper.ts': names(1) }), 8, importers).size).toBe(0)
  })

  it('never makes a hub of a component a story imports directly', () => {
    const [own, page] = names(2)
    const importers = importedBy({ 'Notice.tsx': [own!, 'a.tsx', 'b.tsx'] })
    const stories = reach({ 'Notice.tsx': [own!, page!], [own!]: [own!], [page!]: [page!] })
    expect(sharedStoryFiles(stories, 8, importers).size).toBe(0)
  })

  it('never shares a story file', () => {
    const files = names(5)
    expect(sharedStoryFiles(reach({ [files[0]!]: files }), 5, noImporters).size).toBe(0)
  })
})

describe('mapNameKey', () => {
  it('ignores case and treats runs of spaces, hyphens and underscores as one separator', () => {
    expect(mapNameKey('Feature page')).toBe('feature-page')
    expect(mapNameKey('feature-page')).toBe('feature-page')
    expect(mapNameKey('  Feature __ - Page ')).toBe('feature-page')
  })

  it('matches nothing fuzzier — plurals stay apart', () => {
    expect(mapNameKey('Coupon')).not.toBe(mapNameKey('Coupons'))
  })
})

describe('groupMap', () => {
  it('recognises page stories by their path alone', () => {
    expect(isPageStory('./.runcastle/stories/pages/1-onboarding/Welcome.stories.tsx')).toBe(true)
    expect(isPageStory('.runcastle/stories/pages/A.stories.tsx')).toBe(true)
    expect(isPageStory('./.runcastle/stories/burn/Lane.stories.tsx')).toBe(false)
    expect(isPageStory('./src/pages/A.stories.tsx')).toBe(false)
  })

  it('drops component stories: only page stories reach the map', () => {
    const groups = groupMap({
      stories: [story('Checkout/CouponField', 'Expired', 'CouponField.stories.tsx')],
      scenarios: [],
    })
    expect(groups).toEqual([])
  })

  it('groups a page story by its whole title, one or two levels', () => {
    const groups = groupMap({
      stories: [
        page('Checkout', 'Empty', 'checkout.stories.tsx'),
        page('Checkout/Coupons', 'Applied', 'coupons.stories.tsx'),
      ],
      scenarios: [],
    })
    expect(outline(groups)).toEqual(['checkout: Checkout', '  checkout/coupons: Coupons'])
    expect(groups[0]?.pages[0]?.states.map((s) => s.name)).toEqual(['Empty'])
    expect(groups[1]?.pages[0]?.states.map((s) => s.name)).toEqual(['Applied'])
  })

  it('folds segments past the second level into the second, prefixed to the state name', () => {
    const groups = groupMap({
      stories: [page('Feature/Review/Drive', 'Waiting', 'drive.stories.tsx')],
      scenarios: [scenario('feature/review/deep/expired.ts')],
    })
    expect(outline(groups)).toEqual(['feature: Feature', '  feature/review: Review'])
    expect(groups[1]?.pages[0]?.states.map((s) => s.name)).toEqual(['Drive · Waiting'])
    expect(groups[1]?.scenarios.map((s) => s.name)).toEqual(['Expired'])
  })

  it('makes a single-segment page title a top-level group of its own, never Ungrouped', () => {
    const groups = groupMap({
      stories: [page('Onboarding', '1 Welcome', 'welcome.stories.tsx')],
      scenarios: [scenario('fresh-install.ts')],
    })
    expect(outline(groups)).toEqual(['onboarding: Onboarding', `${MAP_UNGROUPED}: Ungrouped`])
  })

  it('puts top-level scenario files in Ungrouped', () => {
    const groups = groupMap({ stories: [], scenarios: [scenario('fresh-install.ts')] })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.id).toBe(MAP_UNGROUPED)
    expect(groups[0]?.name).toBe('Ungrouped')
    expect(groups[0]?.scenarios.map((s) => s.name)).toEqual(['Fresh install'])
  })

  it('groups a scenario by its folders, made readable', () => {
    const groups = groupMap({
      stories: [],
      scenarios: [scenario('feature-page/coupon_codes/expired-coupon.ts')],
    })
    expect(outline(groups)).toEqual([
      'feature-page: Feature page',
      '  feature-page/coupon-codes: Coupon codes',
    ])
  })

  it("matches names loosely, and a story title's spelling wins over the folder's", () => {
    const groups = groupMap({
      stories: [page('Feature Page', 'Default', 'Header.stories.tsx')],
      scenarios: [scenario('feature-page/one-ticket.ts'), scenario('FEATURE_PAGE/two.ts')],
    })
    expect(outline(groups)).toEqual(['feature-page: Feature Page'])
    expect(groups[0]?.pages).toHaveLength(1)
    expect(groups[0]?.scenarios.map((s) => s.name)).toEqual(['One ticket', 'Two'])
  })

  it('keeps names that do not match as two groups, never guessing a merge', () => {
    const groups = groupMap({
      stories: [page('Coupons', 'Default', 'Field.stories.tsx')],
      scenarios: [scenario('coupon/expired.ts')],
    })
    expect(outline(groups)).toEqual(['coupons: Coupons', 'coupon: Coupon'])
  })

  it('orders places by their story files numerically, children after their parent, then scenario-only groups, Ungrouped last', () => {
    const groups = groupMap({
      stories: [
        page('Feature/Review', 'Findings', '10-feature/2-review.stories.tsx'),
        page('Feature/Planning', 'Draft', '10-feature/1-planning.stories.tsx'),
        page('Project chooser', 'Empty', '2-project-chooser/empty.stories.tsx'),
        page('Onboarding', '1 Welcome', '1-onboarding/welcome.stories.tsx'),
      ],
      scenarios: [scenario('zeta/a.ts'), scenario('billing/paid.ts'), scenario('top.ts')],
    })
    expect(outline(groups)).toEqual([
      'onboarding: Onboarding',
      'project-chooser: Project chooser',
      'feature: Feature',
      '  feature/planning: Planning',
      '  feature/review: Review',
      'billing: Billing',
      'zeta: Zeta',
      `${MAP_UNGROUPED}: Ungrouped`,
    ])
  })

  it('orders a parent with no pages of its own by its children', () => {
    const groups = groupMap({
      stories: [
        page('B/Child', 'x', '1-b/c.stories.tsx'),
        page('A', 'x', '2-a/a.stories.tsx'),
      ],
      scenarios: [scenario('b/own.ts')],
    })
    expect(outline(groups)).toEqual(['b: B', '  b/child: Child', 'a: A'])
  })

  it('gives each state its step, orders by step numerically then index order, variants after their step', () => {
    const groups = groupMap({
      stories: [
        page('Onboarding', 'Extras', 'o.stories.tsx'),
        page('Onboarding', '10 Done', 'o.stories.tsx'),
        page('Onboarding', '3 Agents · None installed', 'o.stories.tsx'),
        page('Onboarding', '2 Identity', 'o.stories.tsx'),
        page('Onboarding', '3 Agents', 'o.stories.tsx'),
        page('Onboarding', 'More', 'o.stories.tsx'),
      ],
      scenarios: [],
    })
    const states = groups[0]?.pages[0]?.states ?? []
    expect(states.map((s) => [s.step, s.name])).toEqual([
      [2, '2 Identity'],
      [3, '3 Agents'],
      [3, '3 Agents · None installed'],
      [10, '10 Done'],
      [null, 'Extras'],
      [null, 'More'],
    ])
  })

  it('implies a parent for a second-level group, even with no entries of its own', () => {
    const groups = groupMap({
      stories: [],
      scenarios: [scenario('checkout/coupons/expired.ts')],
    })
    expect(groups[0]).toEqual({ id: 'checkout', name: 'Checkout', pages: [], scenarios: [] })
    expect(groups[1]?.parentId).toBe('checkout')
  })

  it('makes one page per story file, holding its states in index order, pages in path order', () => {
    const groups = groupMap({
      stories: [
        page('Checkout', 'Expired', 'b/Field.stories.tsx'),
        page('Checkout', 'Empty', 'a/Basket.stories.tsx'),
        page('Checkout', 'Applied', 'b/Field.stories.tsx'),
        { ...page('Checkout', 'Docs', 'b/Field.stories.tsx'), type: 'docs' },
      ],
      scenarios: [],
    })
    const pages = groups[0]?.pages ?? []
    expect(pages.map((p) => p.importPath)).toEqual([
      '.runcastle/stories/pages/a/Basket.stories.tsx',
      '.runcastle/stories/pages/b/Field.stories.tsx',
    ])
    expect(pages[1]?.states.map((s) => s.name)).toEqual(['Expired', 'Applied'])
  })

  it('skips helper code, dot-files and .http files, and calls follow their scenario', () => {
    const groups = groupMap({
      stories: [],
      scenarios: [
        scenario('checkout/_fixtures/buyer.ts'),
        scenario('checkout/.gitkeep'),
        scenario('checkout/expired.http'),
        scenario('checkout/expired.ts', true),
        scenario('checkout/applied.ts'),
      ],
    })
    expect(outline(groups)).toEqual(['checkout: Checkout'])
    expect(groups[0]?.scenarios).toEqual([
      { file: '.runcastle/scenarios/checkout/applied.ts', name: 'Applied', hasCall: false },
      { file: '.runcastle/scenarios/checkout/expired.ts', name: 'Expired', hasCall: true },
    ])
  })
})

describe('touchesCatalogue', () => {
  const dependsOn = ['src/CouponField.stories.tsx', 'src/CouponField.tsx']

  it('is false for a diff that touches nothing the catalogue reads', () => {
    expect(touchesCatalogue(['docs/features/x/spec.md', 'README.md'], dependsOn)).toBe(false)
  })

  it('is true when a depended-on file changed, however the path is spelled', () => {
    expect(touchesCatalogue(['./src/CouponField.tsx'], dependsOn)).toBe(true)
  })

  it('counts the stories set-up under .runcastle/ but not the scenarios', () => {
    expect(touchesCatalogue(['.runcastle/stories.json'], dependsOn)).toBe(true)
    expect(touchesCatalogue(['.runcastle/storybook/main.ts'], dependsOn)).toBe(true)
    expect(touchesCatalogue(['.runcastle/scenarios/checkout/expired.ts'], dependsOn)).toBe(false)
  })
})

describe('catalogueDependsOn', () => {
  it("lists the story files plus the import graph's repo modules, normalised, without node_modules", () => {
    const index = StoryIndex.parse({
      v: 5,
      entries: {
        a: story('Checkout/CouponField', 'Expired', 'CouponField.stories.tsx'),
        b: story('Checkout/CouponField', 'Applied', 'CouponField.stories.tsx'),
      },
    })
    const stats = PreviewStats.parse({
      modules: [
        { name: './src/CouponField.tsx?v=1' },
        { name: './node_modules/react/index.js' },
        { name: 'src\\tokens.ts' },
      ],
    })
    expect(catalogueDependsOn(index, stats)).toEqual([
      'src/CouponField.stories.tsx',
      'src/CouponField.tsx',
      'src/tokens.ts',
    ])
  })
})

describe('records', () => {
  it('parse the shapes main.json, attempt.json and the model use', () => {
    const entry = { commit: 'abc', at: 1, subject: "Merge branch 'feature/coupons'", featureSlug: 'coupons' }
    expect(
      MainCatalogueRecord.safeParse({
        projectId: 'proj_x',
        commit: 'abc',
        builtAt: 1,
        source: 'promoted',
        featureId: 'feat_x',
        dependsOn: ['src/a.tsx'],
        storyHistory: { 'src/a.stories.tsx': [entry] },
      }).success,
    ).toBe(true)
    expect(MainCatalogueAttempt.safeParse({ commit: 'abc', startedAt: 1, status: 'building' }).success).toBe(true)
    expect(MainCatalogueAttempt.safeParse({ commit: 'abc', startedAt: 1, status: 'built' }).success).toBe(false)
    expect(
      MapModel.safeParse({
        storiesSetUp: false,
        catalogue: { state: 'not_set_up', stale: false, building: false },
        groups: [],
      }).success,
    ).toBe(true)
  })
})
