/**
 * The bin's first import: drop what Bun loaded from a `.env` in the start
 * folder before any other module reads `process.env` (ESM evaluates imports in
 * order, so this body runs first). See `util/drop-dotenv.ts`.
 */
import { dropDotenvFromProcess } from '../util/drop-dotenv'

dropDotenvFromProcess()
