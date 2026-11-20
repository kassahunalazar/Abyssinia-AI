# Abyssinia AI

Windows-first web assistant powered by Hermes Agent. Ask a follow-up in Amharic or English, or select an earlier chat in the sidebar to continue it. Each chat can use its four most recent successful exchanges. Reloading the page clears the sidebar.

## Windows setup

Install Node.js 22 or newer and Hermes Agent v0.23.0. Use the Python executable from the Hermes environment so the worker can import its installed dependencies. Supply an OpenAI-compatible model base URL ending in `/v1` and its model ID. For a provider requiring authentication, set `ASSISTANT_MODEL_KEY` in the process environment before starting. Keep keys out of Git.

```powershell
.\scripts\start.ps1 -Python 'C:\path\to\hermes\python.exe' -HermesSource 'C:\path\to\hermes-agent' -ModelUrl 'http://127.0.0.1:11434/v1' -Model 'your-installed-model'
```

Open [the assistant](http://127.0.0.1:8788). Stop the server with Ctrl+C. Run `node --test` from the repository root.

See [Architecture](ARCHITECTURE.md), [Security](SECURITY.md), and [Test plan](TEST_PLAN.md).
