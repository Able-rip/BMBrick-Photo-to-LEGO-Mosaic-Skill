# BMBrick Agent Mosaic Skill

[![npm version](https://img.shields.io/npm/v/@bmbrick/agent-mosaic-skill)](https://www.npmjs.com/package/@bmbrick/agent-mosaic-skill)
[![License](https://img.shields.io/badge/license-MIT%20%2B%20Restricted-blue)](#license)

Convert any local photo into a LEGO-style brick mosaic preview — directly from your AI agent.

`@bmbrick/agent-mosaic-skill` is an MCP server that lets Claude, Cursor, Windsurf, and other AI agents transform local images into high-fidelity 3D brick mosaics using the same canonical engine as [bmbrick.com](https://bmbrick.com).

## Visual Previews

Generated with the `generate_bmbrick_mosaic` tool (3D render mode):

| Original Photo | 48x48 Preview | 64x64 Preview |
| :--- | :--- | :--- |
| ![Original](https://raw.githubusercontent.com/Able-rip/agent-mosaic-skill/main/assets/cat_original_photo.png) | ![48x48](https://raw.githubusercontent.com/Able-rip/agent-mosaic-skill/main/assets/cat_mosaic_preview.png) | ![64x64](https://raw.githubusercontent.com/Able-rip/agent-mosaic-skill/main/assets/cat_mosaic_64x64.png) |

## Quick Start

```bash
npx -y @bmbrick/agent-mosaic-skill
```

### MCP Client Configuration

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bmbrick-mosaic": {
      "command": "npx",
      "args": ["-y", "@bmbrick/agent-mosaic-skill"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "bmbrick-mosaic": {
      "command": "npx",
      "args": ["-y", "@bmbrick/agent-mosaic-skill"]
    }
  }
}
```

## Tool: `generate_bmbrick_mosaic`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `imagePath` | string | Yes | — | Absolute path to a local image |
| `columns` | number | No | 48 | Preview width in studs (max 64) |
| `rows` | number | No | 48 | Preview height in studs (max 64) |
| `materialMode` | string | No | `square_1x1` | `square_1x1` or `round_1x1` |
| `renderMode` | string | No | `3D` | Render style |
| `removeBackground` | boolean | No | false | Clean up white/transparent backgrounds |

Returns: a local watermarked PNG preview + a link to unlock the full project at [bmbrick.com](https://bmbrick.com).

## Unlock Full Project

The preview is watermarked and intended for creative exploration. To get the complete deliverables — HD unwatermarked mosaic, brick-by-brick PDF instructions, parts list with ordering links, and CSV/XML placement matrices — visit [bmbrick.com](https://bmbrick.com).

## Features

- **Same Engine as bmbrick.com** — canonical color science, quantization, and 3D rendering pipeline
- **Local & Private** — all processing happens on your machine via Node.js
- **Agent-Ready** — ships with a `SKILL.md` for seamless agent workflow integration
- **3D Render Mode** — InstancedMesh PBR rendering with realistic brick studs

## Development

```bash
git clone https://github.com/Able-rip/agent-mosaic-skill.git
cd agent-mosaic-skill
npm install
npm run build    # obfuscate engine + MCP server
npm test         # build + run tests
npm run smoke    # quick smoke test
```

Core algorithms are synced from the [BrickArt](https://github.com/Able-rip/brickmemory) repository — do not edit `dist/lib/` directly.

## License

Dual-licensed:

- **MIT** — MCP wrapper, `skill/` directory, agent integration surface
- **Restricted** — `dist/` engine files: free to use and distribute as-is, but no de-obfuscation, reverse engineering, or redistribution of modified versions

See [LICENSE](LICENSE) for full terms.
