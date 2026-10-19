# Test notes

## Carried, still open

- [→] I got:

┌  Building storybook v10.6.2
│
◇  Cleaning outputDir: ../../../../runcastle-stories-out
│
■  SB_CORE-SERVER_0007 (MainFileEvaluationError): Storybook couldn't
│  evaluate your .runcastle/storybook/main.ts file.

│  Original error:
│  Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
│  Require stack:
│  - /node_modules/lightningcss/node/index.js
│  at Function._resolveFilename
│  (node:internal/modules/cjs/loader:1430:15)
│  at defaultResolveImpl (node:internal/modules/cjs/loader:1040:19)
│  at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1045:22)
│  at Function._load (node:internal/modules/cjs/loader:1216:25)
│  at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
│  at Module.require (node:internal/modules/cjs/loader:1527:12)
│  at require (node:internal/modules/helpers:147:16)
│  at Object.<anonymous> (/node_modules/lightningcss/node/index.js:22:22)
│  at Module._compile (node:internal/modules/cjs/loader:1781:14)
│  at Object..js (node:internal/modules/cjs/loader:1913:10)
│  at loadMainConfig
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/_node-chunks/chunk-XYQ3GU6K.js:14427:11)
│  at async buildStaticStandalone
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/core-server/index.js:7535:16)
│  at async withTelemetry
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/_node-chunks/chunk-JL3YXRU7.js:142:12)
│  at async build
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/bin/core.js:4821:3)
│  at async _Command.<anonymous>
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/bin/core.js:5003:7)
│
└  Storybook exited with an error


npm warn exec The following package was not found and will be installed: storybook@10.6.2

When I clicked the build catalog button (captured lap 1, carried into lap 2)

## Lap 1

- [→] I got:

┌  Building storybook v10.6.2
│
◇  Cleaning outputDir: ../../../../runcastle-stories-out
│
■  SB_CORE-SERVER_0007 (MainFileEvaluationError): Storybook couldn't
│  evaluate your .runcastle/storybook/main.ts file.

│  Original error:
│  Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
│  Require stack:
│  - /node_modules/lightningcss/node/index.js
│  at Function._resolveFilename
│  (node:internal/modules/cjs/loader:1430:15)
│  at defaultResolveImpl (node:internal/modules/cjs/loader:1040:19)
│  at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1045:22)
│  at Function._load (node:internal/modules/cjs/loader:1216:25)
│  at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
│  at Module.require (node:internal/modules/cjs/loader:1527:12)
│  at require (node:internal/modules/helpers:147:16)
│  at Object.<anonymous> (/node_modules/lightningcss/node/index.js:22:22)
│  at Module._compile (node:internal/modules/cjs/loader:1781:14)
│  at Object..js (node:internal/modules/cjs/loader:1913:10)
│  at loadMainConfig
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/_node-chunks/chunk-XYQ3GU6K.js:14427:11)
│  at async buildStaticStandalone
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/core-server/index.js:7535:16)
│  at async withTelemetry
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/_node-chunks/chunk-JL3YXRU7.js:142:12)
│  at async build
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/bin/core.js:4821:3)
│  at async _Command.<anonymous>
│  (file:///home/agent/cache/store/npm/_npx/6fe9a9991b157df1/node_modules/storybook/dist/bin/core.js:5003:7)
│
└  Storybook exited with an error


npm warn exec The following package was not found and will be installed: storybook@10.6.2

When I clicked the build catalog button (carried into lap 2)
