# BMBrick Agent Mosaic Skill

Preview-only local mosaic generation for Agent and MCP workflows.

\@bmbrick/agent-mosaic-skill\ lets an agent convert a local image into a BMBrick LEGO-style mosaic preview on the user's machine. The generated preview uses the same canonical BMBrick preview pipeline as the website, includes a BMBrick watermark, and does not return project data such as placement matrices, parts lists, PDFs, or unwatermarked HD exports.

## Visual Previews

Generated using the \generate_bmbrick_mosaic\ tool (3D render mode):

| Original Photo | 48x48 Preview | 64x64 Preview |
| :--- | :--- | :--- |
| ![Original](https://github.com/Able-rip/agent-mosaic-skill/blob/main/assets/cat_original_photo.png?raw=true) | ![48x48](https://github.com/Able-rip/agent-mosaic-skill/blob/main/assets/cat_mosaic_preview.png?raw=true) | ![64x64](https://github.com/Able-rip/agent-mosaic-skill/blob/main/assets/cat_mosaic_64x64.png?raw=true) |

## Usage

Run directly via \
px\:

\\\ash
npx -y @bmbrick/agent-mosaic-skill
\\\

### MCP Configuration

Add this to your MCP settings file (e.g., \claude_desktop_config.json\):

\\\json
{
  "mcpServers": {
    "bmbrick": {
      "command": "npx",
      "args": ["-y", "@bmbrick/agent-mosaic-skill"]
    }
  }
}
\\\

## Tool: \generate_bmbrick_mosaic\

Inputs:
- \imagePath\: absolute local image path
- \columns\: preview width (default 48, max 64)
- \ows\: preview height (default 48, max 64)
- \materialMode\: \square_1x1\ (default) or \ound_1x1\
- \emoveBackground\: true/false

The result is a local PNG preview path + a link to [bmbrick.com](https://bmbrick.com) for unlocking full HD deliverables.

## Boundaries

This is a **preview-only** tool. It provides a watermarked visual reference but does not expose:
- brick placement data
- parts lists
- PDF instructions
- unwatermarked HD exports

For the complete project, please visit [bmbrick.com](https://bmbrick.com).

## License

- MCP Wrapper & Skill: MIT
- Preview Engine: Restricted (Local watermarked preview use only)
