# Parser and Browser Guidelines

Trellis discovers this single-package spec at `frontend`. The shared APK parser runs through Node.js and browser runtime adapters. The browser demo uses plain HTML and JavaScript.

## Pre-Development Checklist

Read the guides for the areas your change touches.

| Guide | Use for |
| --- | --- |
| [Directory structure](./directory-structure.md) | Entry points, core modules, adapters, demo, and build outputs |
| [Parser and runtime contracts](./parser-runtime.md) | Runtime injection, APK sources, data and error handling |
| [Browser demo](./browser-demo.md) | DOM state, rendering, and object URL lifecycle |
| [Quality and verification](./quality-guidelines.md) | Tests, build, and optional APK validation |

Shared thinking guides live in [guides](../guides/index.md).

## Quality Check

Use the [verification commands](./quality-guidelines.md) and follow the checks for the parser paths or browser demo you changed.
