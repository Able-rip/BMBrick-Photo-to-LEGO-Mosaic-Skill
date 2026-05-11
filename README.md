# BMBrick Agent Mosaic Skill

Preview-only local mosaic generation for Agent and MCP workflows.

`@bmbrick/agent-mosaic-skill` lets an agent convert a local image into a BMBrick LEGO-style mosaic preview on the user's machine. The generated preview uses the same canonical BMBrick preview pipeline as the website, includes a BMBrick watermark, and does not return project data such as placement matrices, parts lists, PDFs, or unwatermarked HD exports.

## Usage

Build the obfuscated distribution:

```bash
npm install
npm run build
```

Run the MCP server:

```bash
npx -y @bmbrick/agent-mosaic-skill
```

The MCP server exposes one tool:

```text
generate_bmbrick_mosaic
```

Inputs:

- `imagePath`: absolute local image path
- `columns`: preview width in studs, default `48`, max `64`
- `rows`: preview height in studs, default `48`, max `64`
- `materialMode`: `square_1x1` or `round_1x1`
- `renderMode`: `3D` only
- `removeBackground`: lightweight local cleanup for white or transparent backgrounds

The result is a local PNG preview path plus `https://bmbrick.com` for unlocking the full project.

Agent previews default to `48x48`, because square mosaics are the common case. Rectangular previews are allowed only when the caller intentionally requests a rectangular crop, such as `64x48` for a landscape image or `48x64` for a portrait image. The engine center-crops the source image to the requested aspect ratio before quantization; it never stretches or squashes the source.

## Preview-Only Boundary

This package intentionally returns only a watermarked preview image. It does not expose:

- brick placement data
- parts lists
- PDF instructions
- unwatermarked HD exports
- reusable project files

Users who want the complete project should upload the source image at [bmbrick.com](https://bmbrick.com).

## Development

The package syncs canonical preview core files from the parent BrickArt repository before every build:

```bash
npm run sync:core
npm run build
npm test
```

Do not edit copied core files inside `src/lib` by hand. Make canonical algorithm changes in the parent BrickArt core, then run `npm run sync:core`.
