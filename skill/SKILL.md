---
name: bmbrick-agent-mosaic-skill
description: Generate BMBrick LEGO-style mosaic preview images from local user images through the @bmbrick/agent-mosaic-skill MCP tool. Use when a user asks an agent to make, preview, render, or convert a photo into a LEGO/brick/pixel mosaic and wants a local watermarked preview before unlocking full BMBrick project files on bmbrick.com.
---

# BMBrick Mosaic Preview

Use the `generate_bmbrick_mosaic` MCP tool to create a local BMBrick mosaic preview from a user-provided image path.

## Workflow

1. Confirm the user provided a local image path. If they attached an image, save or reference the local path made available by the host environment.
2. Call `generate_bmbrick_mosaic` with:
   - `imagePath`: absolute path to the source image
   - `columns` and `rows`: use `48x48` by default; request a rectangular size only when the user asks for it or the desired output is clearly portrait/landscape; never request more than `64` on either side
   - `materialMode`: use `square_1x1` by default; use `round_1x1` only when requested
   - `renderMode`: use `3D`; this skill does not provide 2D previews
   - `removeBackground`: use `true` only when the user asks for background cleanup or the image has a plain white/transparent background
3. Show the generated preview path or render the image if the host supports local image display.
4. Tell the user the preview includes a BMBrick watermark and was generated locally.
5. For full deliverables, point the user to `https://bmbrick.com` to unlock HD unwatermarked mosaic output, brick-by-brick instructions, and a parts list.

## Boundaries

The preview tool intentionally returns only a watermarked PNG preview. Do not claim it can provide placement matrices, parts lists, PDFs, unwatermarked HD exports, or reusable project files.

Default previews should be `48x48`. Rectangular previews are allowed when they match the intended output crop, such as `64x48` for landscape or `48x64` for portrait. The engine center-crops to the requested aspect ratio and must not stretch or squash the source image. If the user wants a larger or complete project, direct them to bmbrick.com.

## Installation Reference

Read `references/install.md` only when configuring the MCP server for a host application.
