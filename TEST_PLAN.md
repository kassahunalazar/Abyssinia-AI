# Test plan

1. Run the HTTP tests on Windows. Verify the Amharic UI entry point, UTF-8 transport, request rejection and error redaction.
2. Run the actual Hermes worker through the HTTP server with a disposable model endpoint. Confirm the model receives neither tool definitions nor out-of-scope context.
3. Repeat with an explicitly approved real model and assess its naturalness, code-switching, reasoning and Ethiopian calendar behavior.
4. Before enabling each subsequent capability, test its allowed path, denial, replay and failure handling. Test real voice capture, transcript quality, playback and prohibited voice selection before enabling speech.
