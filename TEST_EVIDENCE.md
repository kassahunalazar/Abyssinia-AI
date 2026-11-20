# Windows test evidence

20 November 2026. Windows, Node v24.15.0, Hermes v0.23.0 at 2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19, Python 3.14.9.

Executed node --test from D:\Codex\amharic-hermes with ASSISTANT_PYTHON and ASSISTANT_HERMES_SOURCE set to the installed Hermes environment. Result was 4 passed, 0 failed, 0 skipped in 19.5 seconds.

| Test | Result |
| --- | --- |
| Real Hermes worker to a loopback streaming fixture | Passed. Verified Amharic input and output, Amharic system guidance and zero model tools. |
| Amharic page and UTF-8 over HTTP | Passed |
| Unrelated origin, oversized request and blank message | Passed |
| Redaction on model failure | Passed |

Initial runs revealed that triggering Hermes dependency preparation at request time exceeded the worker limit. The worker now uses the supplied environment and disables lazy installs. The integration fixture was corrected to use OpenAI-compatible server-sent events after its JSON-only response triggered Hermes stream retries.

Model-generated Amharic quality and live speech are pending. The deterministic fixture exercises Hermes and HTTP transport. It supplies a fixed Amharic response. Persistent memory, approved tools, MCP, the coding specialist and automations are later milestones.

## Live OmniRoute smoke test

20 November 2026. Sent a short Amharic prompt asking for one sentence about Addis Ababa through the assistant HTTP API, the installed Hermes worker, and the loopback OmniRoute gateway at port 20128. The advertised route was `kc/openrouter/free`. The request returned HTTP 200 and a one-sentence Amharic answer identifying Addis Ababa as Ethiopia's capital and a political and economic center.

The route selects an upstream model dynamically. This test verifies one working text turn. Native-speaker evaluation, model comparisons, and speech tests are pending.

A follow-up at the normal app address returned a Hermes repetition-stop warning instead of an Amharic answer. The named Qwen route was on cooldown (429), Gemini Flash-Lite returned invalid upstream authentication (401), and auto/best-chat timed out. The local server remains configured with the free route. Reliable model selection is pending.

## AionUi-style frontend verification

Compared the layout with the [official AionUi homepage screenshot](https://github.com/iOfficeAI/AionUi/blob/main/resources/homepage.png). The Amharic interface uses the sidebar, centered Hermes selector, rounded composer, and prompt-card layout. Chat history and search cover this open page session.

The Windows suite passed 4 of 4 tests, including the installed Hermes worker against a deterministic streaming model endpoint. A separate clean Chromium run verified desktop (1440 × 900) and mobile (390 × 844) layouts, prompt insertion, submit, literal text rendering, new chat, chat switching, search, normalized failure with draft restoration, and the mobile sidebar. The UI submission checks used a fixture reply.

## M1 conversation context · 20 November 2026

Implemented a per-chat continuation handle and forwarded the latest four successful exchanges through the installed Hermes conversation_history interface.

| Check | Observed result |
| --- | --- |
| Baseline | Three HTTP tests passed. Hermes was skipped until the installed Python and source paths were supplied. |
| Windows node --test with real Hermes | Five passed, zero failed, zero skipped in 39.8 s on retry. The first configured run hit the 180 s worker timeout. Its root cause is unresolved. |
| Model boundary | A deterministic streaming endpoint saw the Amharic first prompt, assistant response and follow-up in order. Both requests had zero tools. |
| Browser | A fresh headless Edge session created two chats, switched back to the first and received a fixture reply dependent on its own earlier message. |
| Live model | The application served HTTP 200 on a temporary loopback port. Two Amharic turns through OmniRoute's kc/openrouter/free route returned 200. One exact-phrase check missed. A separate UTF-8 run returned እሺ to the first prompt and exactly AGAR-724 when asked for the earlier marker. |
| Blocked | No blocker to delivering bounded text context. Reliable upstream model selection remains open. |
| Not run | Native-speaker quality evaluation, voice tests, security-hardening suite, installer tests. |
| Known limitations | The browser loses chat handles on reload. The gateway cache is volatile. Route quality and latency vary. |
| Next step | Establish repeatable live Amharic model results before expanding the M2 session and activity UI. |
