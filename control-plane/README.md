# Control Plane

Kubernetes fault-injection control plane for LB_Test_WebSite. Provides a
dashboard UI and API for applying fault-injection modes (http_500, http_503,
slow, wrong_body, reset) to targeted pods via ConfigMap patches.

## EJS partials symlink

The dashboard reuses the main app's EJS partials (head, nav, footer, icon)
through a symlink:

```
control-plane/views/partials -> ../../views/partials
```

This avoids duplicating template fragments and ensures visual consistency:
design tokens, CSS, and JS files all come from the root `public/` directory.

### How to maintain

- **Modifying shared partials** (head, nav, footer, icon): edit
  `views/partials/*.ejs` in the project root. The symlink reflects changes
  immediately — no copy step needed.
- **Adding a new partial** shared by both apps: create it in the root
  `views/partials/` and reference it from dashboard.ejs via
  `<%- include('partials/<name>') %>`.
- **Dashboard-specific partials**: create them inside
  `control-plane/views/partials/` (the symlink won't shadow them — EJS
  resolves relative paths before following the symlink).

### Static assets

CSS and JS are served from the root `public/` directory via an Express
static middleware. See `src/api/routes.js` for the mount path.
