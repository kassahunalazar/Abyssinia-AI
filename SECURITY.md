# Security

The web server binds to 127.0.0.1 and validates Host and Origin on chat requests. It serves fixed assets, limits prompt size and worker runtime, and renders model output as text. A local OS process can still access the interface. Run under a trusted user and use a trusted Hermes checkout and model endpoint. A remote model receives the prompt.

The worker receives an explicit environment and requires an empty tool list. Future bridge actions must enforce scoped, expiring, single-use manual approvals at execution. Workspace reads and writes must enforce path containment and reject links or junctions that can redirect operations. Shell, browser and desktop capabilities require separately scoped permissions. YOLO mode is prohibited.

Permanently reject `am-ET-AmehaNeural` and `am-ET-MekdesNeural` across every future speech provider, override and fallback.
