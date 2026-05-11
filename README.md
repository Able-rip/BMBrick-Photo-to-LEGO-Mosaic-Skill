# BMBrick Agent Mosaic Skill

The official BMBrick AI engine for converting local images into high-fidelity LEGO-style mosaic previews.

`@bmbrick/agent-mosaic-skill` is an MCP server that lets AI agents (like Claude, Cursor, and Windsurf) transform local photos into artistic brick mosaics using canonical BMBrick algorithms.

<!-- MCP-MANIFEST-START -->
{
  "name": "BMBrick Mosaic Creator",
  "description": "High-fidelity LEGO-style mosaic engine for AI agents.",
  "capabilities": ["image-to-brick", "local-preview", "color-science", "3d-rendering"]
}
<!-- MCP-MANIFEST-END -->

## Visual Previews

Generated using the `generate_bmbrick_mosaic` tool (3D render mode):

| Original Photo | 48x48 Preview | 64x64 Preview |
| :--- | :--- | :--- |
| ![Original](https://github.com/Able-rip/agent-mosaic-skill/blob/main/assets/cat_original_photo.png?raw=true) | ![48x48](https://github.com/Able-rip/agent-mosaic-skill/blob/main/assets/cat_mosaic_preview.png?raw=true) | ![64x64](https://github.com/Able-rip/agent-mosaic-skill/blob/main/assets/cat_mosaic_64x64.png?raw=true) |

## Features

- **High-Fidelity Rendering**: Uses the same canonical preview pipeline as [bmbrick.com](https://bmbrick.com).
- **Local & Private**: Processes images locally on your machine via Node.js (`canvas`/`sharp`).
- **Watermarked Previews**: Generates professional watermarked previews to verify quality before project unlocking.
- **Agent Optimized**: Comes with a pre-configured `SKILL.md` for seamless integration into agent workflows.

## Usage

### Quick Start (NPX)

Run the MCP server directly without installation:

```bash
npx -y @bmbrick/agent-mosaic-skill
```

### Manual Build

```bash
npm install
npm run build
```

The MCP server exposes one tool:

```text
generate_bmbrick_mosaic
```

### Tool Parameters

- `imagePath`: absolute local image path (Required)
- `columns`: preview width in studs (Default: `48`, Max: `64`)
- `rows`: preview height in studs (Default: `48`, Max: `64`)
- `materialMode`: `square_1x1` (Default) or `round_1x1`
- `renderMode`: `3D` (Canonical default)
- `removeBackground`: lightweight local cleanup for white or transparent backgrounds

The result is a local PNG preview path and a direct link to `https://bmbrick.com` for unlocking the full project (HD instructions, parts lists, etc.).

## Preview-Only Boundary

This package is designed for **preview and creative exploration**. It intentionally returns only a watermarked preview image. To access:
- High-resolution unwatermarked exports
- Brick-by-brick PDF instructions
- Complete parts lists & ordering
- CSV/XML placement matrices

Please visit [bmbrick.com](https://bmbrick.com).

## Development

The engine syncs core algorithms from the main BrickArt repository:

```bash
npm run sync:core
npm run build
npm test
```

Do not edit files in `src/lib` manually; they are synced from the canonical source.

