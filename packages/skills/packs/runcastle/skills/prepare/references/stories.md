# UI states — set up the project's stories

The steps that let runcastle show a project's components on a feature's page. Runcastle builds the catalogue at review, in the sandbox, and frames the stories a feature added or changed; it never starts the app for them. Follow the steps in order. Storybook is the only supported tool: on a Flutter or backend-only project, stop here.

To the human this is "showing your components in runcastle". Name only the dev dependencies you are about to install; the tool is runcastle's machinery, not theirs.

Everything you write lives under `.runcastle/`. The one trace outside it is the dev dependencies in the project's package manifest and lockfile.

## The contract

`.runcastle/stories.json`, committed. Its presence on a branch is what "this project has stories" means:

```json
{ "build": "<pm exec> storybook build -c .runcastle/storybook --stats-json --disable-telemetry --quiet -o {out}" }
```

- `{out}` is the only placeholder. Runcastle substitutes a directory and reads `{out}/index.json` (every story) and `{out}/preview-stats.json` (the import list it matches a feature's diff against).
- `--stats-json` is required. Without it runcastle cannot tell which stories a feature touched.
- The command runs from the repo root, in a sandbox with dependencies installed and no network services.

## The steps

0. **Reuse first.** If the repo already has a Storybook (a `.storybook/` directory, or a `storybook` dependency in any manifest), install nothing. Write `.runcastle/stories.json` pointing its `-c` at that config dir, with `--stats-json`, then go to step 9.

1. **Install through the project's own package manager**, as exact-pinned dev dependencies: `storybook` and the framework package for the app's stack (`@storybook/react-vite`, `@storybook/vue3-vite`, `@storybook/sveltekit`, `@storybook/angular`, …), plus `msw` and `msw-storybook-addon` if step 5 uses MSW. Put them in the package that owns the UI. In a workspace, put them at the root when files under `.runcastle/` must resolve them (see gotchas). Before pinning, check the framework package's `peerDependencies` for the app's bundler and framework majors. If no release supports them, say so and stop. Never downgrade the app.

2. **Config in `.runcastle/storybook/`**, never a root `.storybook/`. `main.ts` sets:
   - `stories: ['../stories/**/*.stories.@(js|jsx|ts|tsx|mdx)']`, narrowed to the extensions the project uses;
   - `core: { disableTelemetry: true }`.

   Story files live in `.runcastle/stories/<product-group>/<Component>.stories.<ext>`, titled `<Group>/<Component>`, for example `checkout/CouponField.stories.tsx` titled `Checkout/CouponField`.

3. **Reuse the app's bundler config**: its framework plugins, CSS pipeline and aliases, so a story compiles exactly as the app does. For Vite, point the builder at the app's config (`framework.options.builder.viteConfigPath`), or merge what you need in `viteFinal`. The dev-server proxy plays no part in a static build. For example, in a monorepo:

   ```ts
   framework: {
     name: '@storybook/react-vite',
     options: { builder: { viteConfigPath: fileURLToPath(new URL('../../apps/web/vite.config.ts', import.meta.url)) } },
   },
   ```

4. **Providers in `preview`**: import the app's CSS entries in the order its entry file does, then add one global decorator that wraps every story in the app's providers: theme, router, translations, the signed-in user, the data client. Build them the way the app's entry file does, with story-local instances (a fresh query client per story, `retry: false`). Put a light/dark switch on a global if the app has themes.

5. **Fake data at the edge only.** Either intercept the network (MSW: `msw` + `msw-storybook-addon`, its worker file generated into a static dir under `.runcastle/storybook/` and served with `staticDirs`), or answer at the data client's own transport or cache (seed TanStack Query / Apollo / SWR). Never `vi.mock`, alias, or stub the app's own modules: a story must run the component unchanged. Type the fake responses from the API's own types, so an API change breaks the typecheck. For example, with tRPC, hand the client's links a `fetch` that answers its wire format from handlers typed by `inferRouterOutputs<AppRouter>`. An unfaked call should fail loudly, never reach a real server.

6. **Exactly one page-level story** that loads its data through that faking. It proves the wiring. Every other state is a plain prop story; feature work writes the rest. Reuse the tests' sample data where it exists: import it, don't copy it.

7. **Typecheck the stories.** The catalogue build does not typecheck, so add `.runcastle/storybook/tsconfig.json` covering `.runcastle/storybook` and `.runcastle/stories`, with the app's compiler options (JSX, DOM lib, path mappings). Name dot-folder files explicitly (`./**/*.ts`): tsc's wildcards skip dot-folders otherwise. Leave the project's own `tsconfig` untouched. Its command (`<pm exec> tsc --noEmit -p .runcastle/storybook/tsconfig.json`):
   - in a prepare session, propose appending it as a `verifyCommands` line and record it with the human's agreement;
   - in a repo where you edit scripts (a ticket), append it to the existing typecheck script.

8. **Write `.runcastle/stories.json`** as in the contract above, with the project's exec form (`bunx`, `npx`, `pnpm exec`, `yarn`).

9. **Evidence: build once.** Run the command with `{out}` replaced by a scratch directory outside the repo. It must exit 0, `index.json` must list the page story, and `preview-stats.json` must exist. Then run the stories typecheck. Never commit the output.

10. **Show the human the files, then commit**: `.runcastle/storybook/`, `.runcastle/stories/`, `.runcastle/stories.json`, the manifest and the lockfile.

## Never

- `storybook dev`, or any story dev server on the host.
- Editing app source to make a story render. If a component cannot render in isolation, pick a different one, or fake one level further out.
- A root `.storybook/`, or stories next to components.
- A Storybook test addon or a browser in the test run. Stories are a catalogue, not a test tier, and never replace a test.
- The word "Storybook" in anything the human reads in runcastle.

## Gotchas

From setting up runcastle's own dashboard (React 19, Vite 8, Tailwind 4, tRPC + TanStack Query, a bun workspace):

- **Vite majors.** Storybook 10.6 supports Vite 5–8 (`@storybook/react-vite`'s peer range). Read the peer range rather than trusting a blog post.
- **Telemetry.** Pass `--disable-telemetry` and set `core.disableTelemetry`. The sandbox has no business phoning home, and the notice clutters the build log runcastle shows on failure.
- **Isolated installs.** With an isolated linker (bun workspaces, pnpm), files under `.runcastle/` resolve packages from the repo root, not from the UI package. Anything the config or stories import directly (`react`, the data client, fonts, `@types/*`) must also be a root dev dependency at *exactly* the UI package's version. A different version loads a second copy, and the providers silently stop matching the components' hooks.
- **CSS entries.** Import the app's CSS files themselves, in the app's order (fonts, tokens, then base styles). Tailwind 4 scans for classes from its `source()`, relative to the CSS file, so a utility class that appears only in a story file is never generated. Keep layout in components.
- **CSS in the typecheck.** The stories typecheck sees the app's side-effect CSS imports. Give it `declare module '*.css'` in a `.d.ts` under `.runcastle/storybook/`, or the bundler's client types.
- **Other tsconfigs that glob `.runcastle/`.** A config that includes `.runcastle/**/*.ts` for drive scripts will pick up the catalogue's browser code under the wrong environment. Exclude `.runcastle/storybook` and `.runcastle/stories` there.
- **A live channel opened on start.** An app that opens an SSE stream or WebSocket from its root (here `App` started `new EventSource('/api/stream')`) must not open it in a story. Render the page story below the component that opens it, or fake the endpoint at the edge. Never edit the app's module to stop it.
- **Plain HTTP beside the data client.** A read that bypasses the client (a raw `fetch` into a query) is not answered by a transport fake. Seed its query key in the story, and set `staleTime: Infinity` on the story client so seeded data is not refetched straight away.
