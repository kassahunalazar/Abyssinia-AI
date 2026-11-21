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
## Windows package and workspace controls

Extract the Windows ZIP into a folder you own and double-click **Open Abyssinia AI.cmd**. This opens the local browser workspace and uses the included Node runtime. The package looks for the installed Hermes environment under LocalAppData. Put backend-only configuration in `%LOCALAPPDATA%\AbyssiniaAI\.env`. Packaged runs keep their approvals, reminders and audit data in `%LOCALAPPDATA%\AbyssiniaAI\data`. To reproduce the package, run `powershell -File scripts/build-windows.ps1` from a clean checkout.

In AK Code Engine, select a source file in the Windows picker. Edit the draft yourself or explicitly send its contents and a change request to the selected model. Check JavaScript or Python syntax before approval. Review the complete before and after text in the inbox. Approval writes that revision, and rollback needs its own approval. Editing is limited to one selected file at a time.

In Connections, add a local MCP HTTP endpoint to inspect its advertised tools. The connection can be disabled or removed. Under desktop controls, select a window and request focus or a page scroll. Each action requires approval. OCR remains available for a frame you select yourself.

The voice evaluation panel records short samples, transcribes them with an installed local model and lets you correct the text before adding it to chat. Speech playback requires a configured speech provider and a qualifying native-listener review. Local model weights and personal credentials are outside the package.

The optional Hohe speech model is distributed separately under CC BY 4.0. Original Amharic model by Chapi and Dataset.ET, based on Ethio-ASR; INT8 ONNX conversion by Yaredoffice. [Original model](https://huggingface.co/snapwre/hohe-asr-amharic) · [Quantized weights](https://huggingface.co/Yaredoffice/hohe-asr-amharic-onnx-int8) · [License](https://creativecommons.org/licenses/by/4.0/)
