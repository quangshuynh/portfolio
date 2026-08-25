# Quang Huynh - Software Engineering Portfolio

Personal portfolio highlighting professional software engineering experience, backend and data-oriented projects, technical breadth, and education.

**Live site:** [quangshuynh.github.io/portfolio](https://quangshuynh.github.io/portfolio/)

## Stack

- React 18 and Create React App
- Plain CSS with responsive layouts and reduced-motion support
- React Icons
- GitHub Pages deployment through GitHub Actions

## Local development

```bash
npm install
npm start
```

Run the test suite or create a production build:

```bash
npm test -- --watchAll=false
npm run build
```

## Deployment

The `homepage` field in `package.json` configures production assets for the `/portfolio/` subpath.

- Every pull request and push runs CI (`.github/workflows/ci.yml`): install, test, and production build.
- Every push to `main` also runs the Pages deployment workflow (`.github/workflows/deploy-pages.yml`), which builds the site and publishes the `build` directory to GitHub Pages automatically.

No manual deploy step is needed — merging to `main` is enough.

Portfolio content is curated locally in `src/components`, so featured work remains available without relying on the GitHub API at runtime.
