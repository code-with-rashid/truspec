# @truspec/mcp-server

The first-party MCP server for [TruSpec](https://github.com/code-with-rashid/truspec), exposing the engine to AI agents (Claude Code, Cursor, etc.).

```bash
claude mcp add truspec -- npx -y @truspec/mcp-server
```

Or in your MCP client config:

```json
{ "mcpServers": { "truspec": { "command": "npx", "args": ["-y", "@truspec/mcp-server"] } } }
```

10 tools: `list_collections`, `run_request`, `run_collection`, `create_request`, `update_request`, `drift`, `coverage`, `scaffold_from_spec`, `mock_start`, `mock_stop`. Create/update validate against the schema before writing.

## Documentation

- **[AI agents (MCP) guide](https://code-with-rashid.github.io/truspec/mcp)** — install, every tool's inputs, and client configuration.
- **[Full documentation](https://code-with-rashid.github.io/truspec/)** — concepts, file format, spec sync, and more.

See the [main README](https://github.com/code-with-rashid/truspec#readme).

MIT
