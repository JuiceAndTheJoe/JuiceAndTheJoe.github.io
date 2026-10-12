# Projects for Märtha

Each project lives in its own subdirectory. Nothing here is linked from the
main site's navigation yet. This is organization, not access control: committed
files may still be reachable by their direct URLs on GitHub Pages.

## Projects

- `wheel/`: Petal Wheel, imported from `wheel.html`. The standalone entry point
  is `wheel/index.html`.
- `cross-stitch-designer/`: React + TypeScript + Vite project, including its
  editable source. The static entry point is `cross-stitch-designer/dist/index.html`.

## Updating the designer

From `cross-stitch-designer/`, run:

```sh
npm ci
npm run dev
```

To refresh the static version, run `npm run build` and commit the resulting
`dist/` files along with the source changes. Build assets use relative paths so
the project can live under this directory. Installed dependencies are ignored.

## Adding projects

Create a descriptive, lowercase, hyphen-separated directory alongside the
existing projects and add it to the list above. Keep each project's assets,
source, and build configuration inside its directory. For standalone HTML
projects, use `index.html` as the entry point. Keep generated static output for
build-based projects in their own `dist/` directory.

Add a collection page or site navigation link separately when ready.
