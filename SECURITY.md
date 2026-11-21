# Security

The web server binds to 127.0.0.1 and validates Host and Origin on chat requests. It serves fixed assets, limits prompt size and worker runtime, and renders model output as text. A local OS process can still access the interface. Run under a trusted user and use a trusted Hermes checkout and model endpoint. A remote model receives the prompt.

The worker receives an explicit environment and checks that tool permissions match the specific turn. A selected UTF-8 attachment grants one in-memory read of up to 16 KiB. No caller-supplied path is opened. The provider receives the text if it requests the read, and a reply may quote file contents. Future bridge actions must enforce scoped, expiring, single-use manual approvals at execution. Workspace reads and writes must enforce path containment and reject links or junctions that can redirect operations. Shell, browser and desktop capabilities require separately scoped permissions. YOLO mode is prohibited.

Permanently reject `am-ET-AmehaNeural` and `am-ET-MekdesNeural` across every future speech provider, override and fallback.

Local browser API calls require the exact gateway origin and an HttpOnly, SameSite=Strict session cookie issued by the loopback page. A trusted local OS account remains the security boundary. File creation accepts a single text or Markdown filename, consumes an expiring approval, checks the actual document directory and uses exclusive creation. Pause invalidates outstanding approvals. Documents, reminder titles, and a rolling 200-entry activity history live in the ignored runtime directory. The app keeps transcripts and confirmed notes in this browser profile. Deleting a browser transcript removes its local display copy.

Screen capture requires the browser picker. Windows OCR receives one PNG through a fixed local helper's stdin. Search sends the query to the chosen language edition of Wikipedia. The screen text, project code and retrieved sources can be reviewed before sending them to the configured model.
## Scoped coding, desktop and voice

A source grant authorizes a single canonical UTF-8 file selected through the Windows dialog. File identity, exact content and size are checked before applying an edit. Approval is single-use, expires after two minutes and becomes invalid when the grant closes. The gateway rejects hard-linked files and noncanonical paths. Atomic replacement uses a sibling temporary file. A process able to modify the same directory concurrently remains a local trust boundary.

Windows focus and scroll are off by default. Requests bind to an enumerated window identity and operation and are checked again at execution. MCP discovery accepts only an explicit IPv4 loopback HTTP endpoint and treats the returned tool names as display text. Audio and transcripts sent for voice evaluation are initiated by the user. Synthesis credentials stay on the gateway. Only enumerated speech model/voice combinations can be evaluated.
