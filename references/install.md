# BMBrick MCP Installation

Build the package before configuring a host:

```bash
cd C:\Users\ripable\Desktop\BrickArt\bmbrick-mosaic-engine
npm install
npm run build
```

Example MCP server configuration for local development:

```json
{
  "mcpServers": {
    "bmbrick": {
      "command": "node",
      "args": [
        "C:\\Users\\ripable\\Desktop\\BrickArt\\bmbrick-mosaic-engine\\dist\\mcp-server.js"
      ]
    }
  }
}
```

When published to npm, the configuration can be:

```json
{
  "mcpServers": {
    "bmbrick": {
      "command": "npx",
      "args": ["-y", "@bmbrick/agent-mosaic-skill"]
    }
  }
}
```
