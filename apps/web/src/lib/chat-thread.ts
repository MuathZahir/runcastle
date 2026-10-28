/**
 * What a chat thread shows (chat-as-web-components). The shapes live in core
 * beside the reducer that produces them (`foldThread`), so the server and the
 * web fold a thread's log the same way; this module is the web's one import
 * point for them.
 */
export type {
  Ask,
  AskAnswer,
  Attachment,
  BackgroundTask,
  ContextUsage,
  DiffLine,
  Effort,
  FileChange,
  FormField,
  FormValues,
  ModelChoice,
  PlanEntry,
  Question,
  QuestionOption,
  SlashCommand,
  ThreadEntry,
  ThreadEvent,
  ThreadItem,
  ThreadState,
  ThreadView,
  ToolCall,
  ToolKind,
  ToolStatus,
  UsageLimit,
  UsageReport,
  WorkStep,
} from '@runcastle/core'
export { EMPTY_THREAD_VIEW, foldThread, modelFamily } from '@runcastle/core'
