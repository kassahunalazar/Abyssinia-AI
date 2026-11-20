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
