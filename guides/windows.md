# Abyssinia AI

Windows-first web assistant powered by Hermes Agent. Ask a follow-up in Amharic or English, or select an earlier chat in the sidebar to continue it. Each chat can use its four most recent successful exchanges. This browser keeps up to 32 transcripts with the latest 40 messages each. Restarting the gateway ends their live model context.

## Start the Windows app

Double-click **Abyssinia AI.cmd**, then open **http://127.0.0.1:8789**. Keep the launcher window open while using the app. The launcher uses the installed Node.js and Hermes environment, and defaults to the local OmniRoute service. For an alternate installation, configure ASSISTANT_PYTHON and ASSISTANT_HERMES_SOURCE in a local .env. Select the inference provider in Settings.

Open **የሥራ ቦታ** for source lookup, project file review, local notes, reminders, screen reading, approvals and activity. To create a document, select **በፋይል አስቀምጥ** beneath an answer, edit the name and contents, then approve the exact write. Files are created in the application data folder shown in the approval. Pause interrupts active model or OCR work and suspends reminder delivery. Resume re-enables new work.

Reminders appear inside the app. The gateway must be running for scheduled delivery. Quiet hours use Windows local time. Screen reading uses a single user-selected capture and the installed Windows OCR languages. Review the extracted text before attaching it to a conversation. Local dictation uses installed speech weights.

## Manual Windows setup

Install Node.js 22 or newer and Hermes Agent v0.23.0. Use the Python executable from the Hermes environment so the worker can import its installed dependencies. Supply an OpenAI-compatible model base URL ending in `/v1` and its model ID. For a provider requiring authentication, set `ASSISTANT_MODEL_KEY` in the process environment before starting. Keep keys out of Git.

```powershell
.\scripts\start.ps1 -Python 'C:\path\to\hermes\python.exe' -HermesSource 'C:\path\to\hermes-agent' -ModelUrl 'http://127.0.0.1:11434/v1' -Model 'your-installed-model'
```

Open [the assistant](http://127.0.0.1:8788). Stop the server with Ctrl+C. Run `node --test` from the repository root.

See [Architecture](../ARCHITECTURE.md), [Security](../SECURITY.md), and [Test plan](../TEST_PLAN.md).

Settings lists 47 named provider presets and accepts custom OpenAI-compatible endpoints. Select a service and enter its model ID. Settings shows the server environment variable for that service. Put the credential in the local backend .env and restart the gateway. OmniRoute can also use provider connections configured on your local router. Choose No provider for local functions. Test sends a short turn through Hermes. Save applies to new chats in this browser. Existing chats keep their provider. To authenticate, configure ASSISTANT_MODEL_KEY on the server for the exact ASSISTANT_MODEL_URL. Settings never returns the key. Attach one UTF-8 text file up to 16 KiB to grant one read of that selection for the turn.
## Windows package and workspace controls

Extract the Windows ZIP into a folder you own and double-click **Open Abyssinia AI.cmd**. This opens the local browser workspace and uses the included Node runtime. The package looks for the installed Hermes environment under LocalAppData. Put backend-only configuration in `%LOCALAPPDATA%\AbyssiniaAI\.env`. Packaged runs keep their approvals, reminders and audit data in `%LOCALAPPDATA%\AbyssiniaAI\data`. To reproduce the package, run `powershell -File scripts/build-windows.ps1` from a clean checkout.

In AK Code Engine, select a source file in the Windows picker. Edit the draft yourself or explicitly send its contents and a change request to the selected model. Check JavaScript or Python syntax before approval. Review the complete before and after text in the inbox. Approval writes that revision, and rollback needs its own approval. For a repository task, grant a project folder, select up to four editable files in the map and select the chat edit action. Each proposed replacement has a separate diff and approval.

In Connections, add a local MCP HTTP endpoint to inspect its advertised tools. The connection can be disabled or removed. Under desktop controls, select a window and request focus or a page scroll. Each action requires approval. OCR remains available for a frame you select yourself.

The composer microphone transcribes a short recording with the selected local model and inserts the transcript into the editable draft. Local model weights and personal credentials are outside the package.

The optional Hohe speech model is distributed separately under CC BY 4.0. Original Amharic model by Chapi and Dataset.ET, based on Ethio-ASR; INT8 ONNX conversion by Yaredoffice. [Original model](https://huggingface.co/snapwre/hohe-asr-amharic) · [Quantized weights](https://huggingface.co/Yaredoffice/hohe-asr-amharic-onnx-int8) · [License](https://creativecommons.org/licenses/by/4.0/)

On a new Windows account, the ZIP includes **Setup Abyssinia Engine.cmd**. It runs the verified upstream installer for the exact tested Hermes v0.23.0 commit under your LocalAppData and updates your user PATH. Run it once if the engine is missing. **Open Abyssinia AI.cmd** then opens the product. To install the optional local speech benchmark weights, run `scripts/setup-speech-model.ps1`. The Hohe worker requires Python with NumPy and ONNX Runtime. Set `ASSISTANT_STT_PYTHON` to that interpreter.

**ሰነዶቼ** lists documents saved by the application. Search or read a document, then request approval for a rename or deletion. Connections can request `get_current_time`, `convert_time`, `add`, `subtract`, `multiply` and `divide` when the local server advertises them. Review the endpoint, tool and arguments in the approval inbox. Other discovered tools appear in the catalog.
## Appearance

Open Settings → Theme to choose System, Dark or Light. System follows Windows appearance, including changes while the app is open. The browser remembers explicit selections. The palette covers the composer, history, chat messages, dialogs and approval text.


## Scheduling from chat

Ask **ከአምስት ደቂቃ በኋላ ውሃ መጠጣት አስታውሰኝ።** Select **Review reminder**, check the title and local time, select once, daily or weekly, then save. Ask **ማስታወሻዎቼን አሳየኝ** to see active reminders. Simple relative requests and listing work locally. For more complex timing, Hermes can call a scoped reminder-drafting tool. Saving requires the user's confirmation. Due reminders appear in the browser while the local gateway runs. This schedules in-app reminders; external calendars and unattended execution of other tools are separate capabilities.

## Dictation and capabilities

Click the microphone or press Ctrl+B to start or stop dictation. After speech starts, three seconds of silence ends the recording. The transcript appears in the editable message and waits for you to send it.

Open **ችሎታዎች** for model providers, bundled skills, MCP connectors, available chat tools and Windows controls. Select a skill or tool and add your instruction in the composer. Choose the window or the connector and its tool before asking Hermes for an action. Focus, scroll and MCP calls require their own approval. Use the chat and tool tests in Settings to check a provider separately for each capability.

Schedules can run a fixed public Wikipedia source lookup once, daily or weekly, showing the last result and the next run. Keep the local gateway running for scheduled work. The interface uses locally installed Ethiopia Jiret for body text, Ethiopic Yigezu Bisrat Gothic for the brand, and Waldba Fantuwua for titles. The bundled Noto Sans Ethiopic supplies fallback glyphs. Its SIL Open Font License is included under web/fonts.

## Windows computer use and Hermes coding

Open Capabilities → Computer use. Enable control, list windows, select a window and scan for buttons or editable fields. Select a discovered control and request the exact action. Review the approval to click a button or replace text with the value shown. You can also select the control for chat and describe the action in Amharic. Windows UI Automation determines available controls. Passwords, disabled controls and read-only inputs are excluded. Rescanning invalidates old control selections.

Open AK Code Engine and select one source file. Describe the change in Amharic or English and ask Hermes to prepare it. Hermes calls the scoped read and edit proposal tools. The approval inbox shows the diff and complete content before writing. You can check JavaScript or Python syntax and request rollback. To work on a private copy of committed files, select a Git repository and approve a detached worktree. Choose status, diff or literal search to inspect it, directly or from chat. For general commands, configure a local Docker Linux engine and an already installed image with ASSISTANT_PROJECT_CONTAINER_IMAGE. The command runs on a snapshot and reports its output and exit code.

For a second Hermes opinion, select the specialist tool in Capabilities and describe the analysis. One separate Hermes turn receives the bounded task. It has no file or tool permissions. The planning skill can use the installed Hermes todo_list tool, with tool activity visible while it runs.

## Installed skills, memory and project tests

In Capabilities → Skills, load the installed Hermes catalog, filter by name or description, and select a skill for the conversation. The gateway resolves its instructions from the installed engine. The selected skill inherits the tools granted for that turn. Skills requiring additional services or toolsets need those integrations to execute their full workflows.

Use the sidebar shortcuts for memory, schedules, approvals and coding. Memory entries retain their source and timestamps in the local gateway. Existing browser notes can be imported individually. A note enters chat when you place it in the composer. Schedule history shows recent runs and their outcomes.

For JavaScript tests, select the synchronous `.test.js` or `.test.mjs` file and its imported local modules in AK Code Engine. Select **JS ፈተና አስኪድ**, review the file list, then approve. The runner supports ES modules, synchronous two-argument `test(name, fn)` and the `ok`, `equal` and `strictEqual` assertions. It runs the selected source in a QuickJS WebAssembly guest with a 16 MiB heap and a two-second execution budget. The test output shows each case. Node filesystem APIs, terminal processes and package scripts are outside this runner.

The article reader previews approved English and Amharic Wikipedia articles and can extract text from a locally selected HTML file. Linked articles require their own approval. Select the preview for chat to send its text to the configured model.

The bundled test engine uses quickjs-emscripten-core and @jitl/quickjs-singlefile-cjs-release-sync 0.32.0, bundled for Node with esbuild 0.28.2. The distribution notices are in vendor/quickjs/LICENSE.

## Approved browser forms

In the browser workspace, open a public HTTPS page with Edge. Select a visible text field, checkbox or list. Review the destination and field values before approving submission. This isolated reader supports ordinary HTML forms. Sites that require scripts, sign-in, cookies or uploads need a different workflow.
