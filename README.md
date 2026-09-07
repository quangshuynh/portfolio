# Quang Huynh - Software Engineering Portfolio

Personal portfolio highlighting professional software engineering experience, backend and data-oriented projects, technical breadth, and education.

[![CI](https://github.com/quangshuynh/portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/quangshuynh/portfolio/actions/workflows/ci.yml)

**Live site:** [quanghuynh.com](https://quanghuynh.com/)

Also deployed to [GitHub Pages](https://quangshuynh.github.io/portfolio/) and [Vercel](https://quangs.vercel.app/).

## Stack

- React 19 and Create React App
- Plain CSS with responsive layouts and reduced-motion support
- React Icons
- GitHub Pages deployment through GitHub Actions
- Vercel deployment from the same repository

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

- CI runs on every pull request and push, installing dependencies, running tests, and verifying a production build.
- Pushes to `main` also deploy to GitHub Pages through `.github/workflows/deploy-pages.yml`. The workflow builds with `PUBLIC_URL=/portfolio` so assets resolve correctly under the GitHub Pages subpath.
- Vercel builds the same repository with the standard `npm run build` command for root deployment. `vercel.json` provides SPA rewrites so routes such as `/about` work when opened or refreshed directly.

No manual deployment step is required after merging to `main`.

Portfolio content is maintained locally in `src/components`, keeping featured project information available without depending on the GitHub API at runtime.
