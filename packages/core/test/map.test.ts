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
import { PreviewStats, StoryIndex, type StoryIndexEntry } from '../src/stories'

const story = (title: string, name: string, file: string): StoryIndexEntry => ({
  id: `${title.toLowerCase().replace(/\//g, '-')}--${name.toLowerCase()}`,
  title,
  name,
  importPath: `./src/${file}`,
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

  it('shares a file reached by more than a quarter of the stories', () => {
    const shared = sharedStoryFiles(reach({ 'theme.ts': names(8), 'helper.ts': names(2) }), 10)
    expect([...shared]).toEqual(['theme.ts'])
  })

  it('needs at least 3 stories, however small the catalogue', () => {
    expect(sharedStoryFiles(reach({ 'helper.ts': names(2) }), 6).size).toBe(0)
    expect(sharedStoryFiles(reach({ 'helper.ts': names(3) }), 6).size).toBe(1)
  })

  it('needs more than a quarter, not exactly a quarter', () => {
    expect(sharedStoryFiles(reach({ 'helper.ts': names(3) }), 12).size).toBe(0)
  })

  it('never shares a story file', () => {
    const files = names(5)
    expect(sharedStoryFiles(reach({ [files[0]!]: files }), 5).size).toBe(0)
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
  it('groups a story by its title minus the component, one or two levels', () => {
    const groups = groupMap({
      stories: [
        story('Checkout/CouponField', 'Expired', 'CouponField.stories.tsx'),
        story('Checkout/Coupons/CouponBadge', 'Default', 'CouponBadge.stories.tsx'),
      ],
      scenarios: [],
    })
    expect(outline(groups)).toEqual(['checkout: Checkout', '  checkout/coupons: Coupons'])
    expect(groups[0]?.components.map((c) => c.name)).toEqual(['CouponField'])
    expect(groups[1]?.components.map((c) => c.name)).toEqual(['CouponBadge'])
  })

  it('folds segments past the second level into the second', () => {
    const groups = groupMap({
      stories: [story('Checkout/Coupons/Deep/Deeper/Badge', 'Default', 'Badge.stories.tsx')],
      scenarios: [scenario('checkout/coupons/deep/expired.ts')],
    })
    expect(outline(groups)).toEqual(['checkout: Checkout', '  checkout/coupons: Coupons'])
    expect(groups[1]?.components.map((c) => c.name)).toEqual(['Badge'])
    expect(groups[1]?.scenarios.map((s) => s.name)).toEqual(['Expired'])
  })

  it('puts single-segment titles and top-level scenario files in Ungrouped', () => {
    const groups = groupMap({
      stories: [story('Button', 'Primary', 'Button.stories.tsx')],
      scenarios: [scenario('fresh-install.ts')],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.id).toBe(MAP_UNGROUPED)
    expect(groups[0]?.name).toBe('Ungrouped')
    expect(groups[0]?.components.map((c) => c.name)).toEqual(['Button'])
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
      stories: [story('Feature Page/Header', 'Default', 'Header.stories.tsx')],
      scenarios: [scenario('feature-page/one-ticket.ts'), scenario('FEATURE_PAGE/two.ts')],
    })
    expect(outline(groups)).toEqual(['feature-page: Feature Page'])
    expect(groups[0]?.components).toHaveLength(1)
    expect(groups[0]?.scenarios.map((s) => s.name)).toEqual(['One ticket', 'Two'])
  })

  it('keeps names that do not match as two groups, never guessing a merge', () => {
    const groups = groupMap({
      stories: [story('Coupons/Field', 'Default', 'Field.stories.tsx')],
      scenarios: [scenario('coupon/expired.ts')],
    })
    expect(outline(groups)).toEqual(['coupon: Coupon', 'coupons: Coupons'])
  })

  it('orders groups alphabetically, case-insensitive, children under their parent, Ungrouped last', () => {
    const groups = groupMap({
      stories: [
        story('Button', 'Primary', 'Button.stories.tsx'),
        story('checkout/Zeta/Z', 'Default', 'Z.stories.tsx'),
        story('Auth/Login', 'Default', 'Login.stories.tsx'),
        story('checkout/Alpha/A', 'Default', 'A.stories.tsx'),
      ],
      scenarios: [scenario('billing/paid.ts')],
    })
    expect(outline(groups)).toEqual([
      'auth: Auth',
      'billing: Billing',
      'checkout: checkout',
      '  checkout/alpha: Alpha',
      '  checkout/zeta: Zeta',
      `${MAP_UNGROUPED}: Ungrouped`,
    ])
  })

  it('implies a parent for a second-level group, even with no entries of its own', () => {
    const groups = groupMap({
      stories: [],
      scenarios: [scenario('checkout/coupons/expired.ts')],
    })
    expect(groups[0]).toEqual({ id: 'checkout', name: 'Checkout', components: [], scenarios: [] })
    expect(groups[1]?.parentId).toBe('checkout')
  })

  it('makes one component per story file, holding its states in index order, components alphabetical', () => {
    const groups = groupMap({
      stories: [
        story('Checkout/CouponField', 'Expired', 'CouponField.stories.tsx'),
        story('Checkout/Basket', 'Empty', 'Basket.stories.tsx'),
        story('Checkout/CouponField', 'Applied', 'CouponField.stories.tsx'),
        { ...story('Checkout/CouponField', 'Docs', 'CouponField.stories.tsx'), type: 'docs' },
      ],
      scenarios: [],
    })
    const components = groups[0]?.components ?? []
    expect(components.map((c) => c.name)).toEqual(['Basket', 'CouponField'])
    expect(components[1]?.importPath).toBe('src/CouponField.stories.tsx')
    expect(components[1]?.states.map((s) => s.name)).toEqual(['Expired', 'Applied'])
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
