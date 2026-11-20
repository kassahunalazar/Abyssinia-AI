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
