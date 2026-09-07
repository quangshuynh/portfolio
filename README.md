# Quang Huynh - Software Engineering Portfolio

Personal portfolio highlighting professional software engineering experience, backend and data-oriented projects, technical breadth, and education.

**Live site:** [quanghuynh.com](https://quanghuynh.com/)
[quangshuynh.github.io/portfolio](https://quangshuynh.github.io/portfolio/)
[quangs.vercel.app](https://quangs.vercel.app/)

## Stack

- React 19 and Create React App
- Plain CSS with responsive layouts and reduced-motion support
- React Icons
- GitHub Pages deployment through GitHub Actions
- Vercel deployment from the same production build

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

- Every pull request and push runs CI (`.github/workflows/ci.yml`): install, test, and production build.
- Every push to `main` also runs the Pages deployment workflow (`.github/workflows/deploy-pages.yml`). That workflow sets `PUBLIC_URL=/portfolio`, builds the site, and publishes the `build` directory to GitHub Pages.
- Vercel uses the normal `npm run build` command without `PUBLIC_URL`, so assets and routes are generated for the domain root. `vercel.json` rewrites application routes such as `/about` to the SPA entry point.

No manual deploy step is needed — merging to `main` is enough.

Portfolio content is curated locally in `src/components`, so featured work remains available without relying on the GitHub API at runtime.
