# Quang Huynh - Software Engineering Portfolio

Personal portfolio highlighting professional software engineering experience, backend and data-oriented projects, technical breadth, and education.

**Live site:** [quangshuynh.github.io/portfolio](https://quangshuynh.github.io/portfolio/)

## Stack

- React 18 and Create React App
- Plain CSS with responsive layouts and reduced-motion support
- React Icons
- GitHub Pages deployment through `gh-pages`

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

The `homepage` field in `package.json` configures production assets for the `/portfolio/` subpath. To build and publish the `build` directory to GitHub Pages:

```bash
npm run deploy
```

Portfolio content is curated locally in `src/components`, so featured work remains available without relying on the GitHub API at runtime.
