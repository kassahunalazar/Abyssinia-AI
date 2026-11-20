# Architecture

The Amharic browser UI posts a message to a Node server on IPv4 loopback. The server runs a trusted, fixed Python worker using the installed Hermes checkout. That worker instantiates the Hermes agent and checks that its effective tool list is empty before making the model call. The worker uses a project-owned Hermes home. The first milestone handles one turn at a time.

## Conversation context

The page holds a handle for each chat. On POST /api/chat, a null conversation starts a chat, a previous handle continues it, and omitting the field preserves the standalone API. The gateway constructs user and assistant history from successful turns and passes it to Hermes through its conversation_history argument. The handle is sensitive. The gateway retains four exchanges per chat in RAM, evicting the least recently updated chat after 32 chats. An expired handle returns HTTP 410. Restarting the gateway clears its cache. Hermes maintains its own ignored runtime directory.

## Milestone gaps

M1 has a working gateway and tool-free Hermes adapter. Live recall and model reliability need separate checks from deterministic transport. M2 has responsive chat navigation and search. Streaming, stop, provider visibility, settings, durable sessions and activity remain open. Before any M3 actions, add browser session authentication, an independent pause control, auditable single-use approvals and workspace enforcement. M4 memory management, M5 native-speaker benchmarking, M6 voice, M7 specialists, M8 automation and MCP, M9 hardening and M10 packaging remain open.

## AionUI frontend review

The React entry composes authentication, theme, conversation history and preview providers around the layout, sidebar and router. Product data crosses a backend HTTP boundary. Electron-specific actions use a separate bridge. [Renderer entry](https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/main.tsx) · [Runtime architecture](https://github.com/iOfficeAI/AionUi/blob/main/docs/architecture/overview.md)

The conversation route loads by ID with SWR and renders ChatConversation. History, messages, plan and preview have dedicated modules. Switching conversations updates the active project and scopes the preview. The layout supports a desktop explorer column and a mobile overlay. [Conversation route](https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/pages/conversation/index.tsx) · [Conversation modules](https://github.com/iOfficeAI/AionUi/tree/main/packages/desktop/src/renderer/pages/conversation) · [Responsive layout](https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/components/layout/Layout.tsx)

| Decision | Agar application |
| --- | --- |
| Reuse directly | No upstream code or assets selected for M1. |
| Adapt | Session selection and project-scoped panels. Keep the active chat visible when secondary panels collapse. |
| Reimplement | Render Amharic-first controls and Hermes activity through the local gateway. |
| Do not use | AionUI branding, bundled agent runtime, desktop permissions or unreviewed assets. For future source reuse, review file-level licenses, preserve applicable notices and identify modified files. [Upstream license](https://github.com/iOfficeAI/AionUi/blob/main/LICENSE) |
