# Architecture

The Amharic browser UI posts a message to a Node server on IPv4 loopback. The server runs a trusted, fixed Python worker using the installed Hermes checkout. That worker instantiates the Hermes agent and checks that its effective tool list is empty before making the model call. The worker uses a project-owned Hermes home. The first milestone handles one turn at a time.

The next milestones add persistent memory, an approval-bound workspace bridge, then scoped coding, research, MCP, local computer use and scheduling integrations. Voice requires real Amharic speech input and output tests plus the permanent exclusion rules in SECURITY.md.
