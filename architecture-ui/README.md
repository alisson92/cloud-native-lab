# Cloud Native Lab — Interactive Architecture

Interactive, animated architecture explorer for
[`alisson92/cloud-native-lab`](https://github.com/alisson92/cloud-native-lab).

## Included views

- platform overview with Kind/GKE environment state;
- end-to-end order flow;
- catalog cache-aside flow;
- CI/CD and GitOps delivery flow;
- Vault and External Secrets flow;
- Airflow nightly data pipeline;
- cluster observability and current instrumentation gaps.

Connections use animated SVG particles to communicate direction and protocol.
Selecting a component opens implementation details grounded in the lab's
manifests and source code.

## Run locally

Requires Node.js `>=20.19.0`.

```bash
npm install
npm run dev
```

Build and test the production artifact:

```bash
npm run build
npm test
```

## Main files

- `app/page.tsx`: graph data, flows, interactions and animated SVG canvas;
- `app/globals.css`: visual system, responsive behavior and component styles;
- `src/main.tsx`: static React entry point;
- `vite.config.ts`: Vite configuration and the GitHub Pages base path.

## GitHub Pages

The repository workflow at `.github/workflows/pages.yml` builds this directory
and publishes `dist/` whenever architecture files change on `main`. In the
repository settings, choose **GitHub Actions** as the Pages source. The site is
then available at:

<https://alisson92.github.io/cloud-native-lab/>

The visualization is explanatory rather than live telemetry. The current
application tier does not expose `/metrics`; the observability view makes that
gap explicit instead of simulating runtime data.
