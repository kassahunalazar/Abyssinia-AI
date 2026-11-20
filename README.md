# Abyssinia AI

Windows-first web assistant powered by Hermes Agent. Ask a follow-up in Amharic or English, or select an earlier chat in the sidebar to continue it. Each chat can use its four most recent successful exchanges. This browser keeps up to 32 transcripts with the latest 40 messages each. Restarting the gateway ends their live model context.

## Start the Windows app

Double-click **Abyssinia AI.cmd**, then open **http://127.0.0.1:8789**. Keep the launcher window open while using the app. The launcher uses the installed Node.js and Hermes environment, and defaults to the local OmniRoute service. For an alternate installation, configure ASSISTANT_PYTHON and ASSISTANT_HERMES_SOURCE in a local .env. Select the inference provider in Settings.

Open **የሥራ ቦታ** for source lookup, project file review, local notes, reminders, screen reading, approvals and activity. To create a document, select **በፋይል አስቀምጥ** beneath an answer, edit the name and contents, then approve the exact write. Files are created in the application data folder shown in the approval. Pause interrupts active model or OCR work and suspends reminder delivery. Resume re-enables new work.

Reminders appear inside the app. The gateway must be running for scheduled delivery. Quiet hours use Windows local time. Screen reading uses a single user-selected capture and the installed Windows OCR languages. Review the extracted text before attaching it to a conversation. Voice input and playback remain pending native-speaker evaluation.

## Manual Windows setup

Install Node.js 22 or newer and Hermes Agent v0.23.0. Use the Python executable from the Hermes environment so the worker can import its installed dependencies. Supply an OpenAI-compatible model base URL ending in `/v1` and its model ID. For a provider requiring authentication, set `ASSISTANT_MODEL_KEY` in the process environment before starting. Keep keys out of Git.

```powershell
.\scripts\start.ps1 -Python 'C:\path\to\hermes\python.exe' -HermesSource 'C:\path\to\hermes-agent' -ModelUrl 'http://127.0.0.1:11434/v1' -Model 'your-installed-model'
```

Open [the assistant](http://127.0.0.1:8788). Stop the server with Ctrl+C. Run `node --test` from the repository root.

See [Architecture](ARCHITECTURE.md), [Security](SECURITY.md), and [Test plan](TEST_PLAN.md).

Settings supports OmniRoute, Ollama, a custom OpenAI-compatible endpoint, and No provider. Test sends a short turn through Hermes. Save applies to new chats in this browser. Existing chats keep their provider. To authenticate, configure ASSISTANT_MODEL_KEY on the server for the exact ASSISTANT_MODEL_URL. Settings never returns the key. Attach one UTF-8 text file up to 16 KiB to grant one read of that selection for the turn.
