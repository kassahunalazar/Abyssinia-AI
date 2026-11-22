# Architecture

The Amharic browser UI posts a message to a Node server on IPv4 loopback. The server runs a trusted, fixed Python worker using the installed Hermes checkout. That worker instantiates the Hermes agent and verifies the effective tool list before each turn. Plain chat has no tools. A user-selected attachment enables only read_attached_text. The worker uses a project-owned Hermes home. The first milestone handles one turn at a time.

## Conversation context

The page holds a handle for each chat. On POST /api/chat, a null conversation starts a chat, a previous handle continues it, and omitting the field preserves the standalone API. The gateway constructs user and assistant history from successful turns and passes it to Hermes through its conversation_history argument. The handle is sensitive. The gateway retains four exchanges per chat in RAM, evicting the least recently updated chat after 32 chats. An expired handle returns HTTP 410. Restarting the gateway clears its cache. Hermes maintains its own ignored runtime directory.

## Milestone gaps

The browser provides local transcripts, user-confirmed notes, reference lookup and read-only project file selection. The gateway owns pause, reminder scheduling, activity and approval-bound document creation. Windows OCR processes one user-selected frame. Remaining milestones include streaming, broader workspace editing, coding worktree execution, interactive desktop control, MCP management, native-speaker speech evaluation and a dependency-bundled installer.

## AionUI frontend review

The React entry composes authentication, theme, conversation history and preview providers around the layout, sidebar and router. Product data crosses a backend HTTP boundary. Electron-specific actions use a separate bridge. [Renderer entry](https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/main.tsx) · [Runtime architecture](https://github.com/iOfficeAI/AionUi/blob/main/docs/architecture/overview.md)

The conversation route loads by ID with SWR and renders ChatConversation. History, messages, plan and preview have dedicated modules. Switching conversations updates the active project and scopes the preview. The layout supports a desktop explorer column and a mobile overlay. [Conversation route](https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/pages/conversation/index.tsx) · [Conversation modules](https://github.com/iOfficeAI/AionUi/tree/main/packages/desktop/src/renderer/pages/conversation) · [Responsive layout](https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/components/layout/Layout.tsx)

| Decision | Abyssinia AI application |
| --- | --- |
| Reuse directly | No upstream code or assets selected for M1. |
| Adapt | Session selection and project-scoped panels. Keep the active chat visible when secondary panels collapse. |
| Reimplement | Render Amharic-first controls and Hermes activity through the local gateway. |
| Do not use | AionUI branding, bundled agent runtime, desktop permissions or unreviewed assets. For future source reuse, review file-level licenses, preserve applicable notices and identify modified files. [Upstream license](https://github.com/iOfficeAI/AionUi/blob/main/LICENSE) |

## Product direction

Abyssinia AI owns the Amharic interface, voice pipeline and approvals. Hermes is the main harness for chat, tools and future memory, skills, delegation and scheduling. Approved tool availability is determined at execution. A tool supported by upstream Hermes needs a scoped integration before it appears as available in Abyssinia AI.

Evaluate upstream AionUI as an experimental Windows frontend using its external agent mode. The shipped Abyssinia interface remains available during evaluation. [AionUI ACP setup](https://github.com/iOfficeAI/AionUi/wiki/ACP-Setup)

AK Code Engine will use T3 Code's thread-to-worktree and diff-review workflow as its reference. Start with a bounded Codex execution adapter under Hermes delegation after repository grants, approvals and cancellation are in place. T3 Code documents a generic ACP option. Interoperability with the installed Hermes version still needs a session test. [T3 Code](https://github.com/pingdotgg/t3code)

Voice selection requires a shared Amharic STT/TTS script and native-speaker evaluation. Keep the existing exclusion policy in SECURITY.md in force at provider registration, selection and fallback.
## November 21 implementation

The gateway can stream Hermes text deltas as NDJSON and preserves JSON responses for existing callers. AK Code Engine holds one revocable native file-picker grant per gateway. Source editing, rollback and Windows window control use the approval inbox. MCP discovery negotiates a loopback HTTP session, requests tool metadata and closes the session. The speech pipeline runs a bounded local transcription subprocess; voice playback uses a separate backend adapter and a native-listener review for the exact model and voice.

Directory-wide edits, Git worktrees, arbitrary project test execution, model-directed MCP calls, and browser form automation still require integrations. The local package includes Node and depends on the installed Hermes environment.

## Repository workspaces and local execution

The gateway grants a native-picked project directory for bounded reads. A chat edit can include up to four explicitly selected editable files, together limited to 16 KiB of serialized context. The read receipt precedes proposals. The server binds each proposed path to that selection, checks the original contents and identity again on approval, and consumes one approval per replacement. Users can approve a subset. Folder revocation invalidates pending folder operations.

The JavaScript test worker loads selected module snapshots and a small synchronous test API in QuickJS WebAssembly. Project code receives no host functions for filesystem, network or process access. The child has a wall-clock timeout, an interruptible guest heap and a bounded reply. The application displays the results and records the outcome. Git worktrees and general-purpose package scripts remain outside this execution adapter.

Confirmed memories and the most recent 100 schedule runs use the local state store. Memory enters model context through an explicit user action. The stock Hermes skill catalog is read from the pinned engine source using its platform filter and metadata parser. Selecting a skill loads its bounded instructions into the next scoped turn. Native desktop controls, article reads and test runs use the approval inbox.

## November 22 execution interfaces

Hermes can request Git inspection and offline project commands from the coding workspace. The gateway binds each proposal to the granted repository and private committed worktree. Git operations run with private configuration. Optional Docker commands receive a snapshot of tracked worktree content, including approved edits. Approval revalidates that snapshot. The container is disposable, so its file changes do not propagate into the worktree.

Selected MCP clock and arithmetic tools use typed gateway schemas and exact single-use approvals. The Edge form reader fetches public HTML through the gateway and renders it in a disposable browser profile with page scripts disabled. The gateway rechecks the form before submission. Local MMS and remote Gemini share the voice evaluation and playback controls.
