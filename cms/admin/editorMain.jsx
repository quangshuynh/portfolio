// QuangEdit inside the local CMS: the public editor (src/editor) with a CMS host that loads
// the photograph's source and saved treatment and saves back to the private workspace.
// Served only by the CMS server (/admin/photography/editor/?photo=<id>); not a build input.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../src/index.css';
import EditorApp from '../../src/editor/ui/EditorApp';
import { createCmsHost } from './editorHost.jsx';
import './editorHost.css';

const photoId = new URLSearchParams(window.location.search).get('photo');
const root = ReactDOM.createRoot(document.getElementById('root'));
if (!photoId || !/^[A-Za-z0-9_-]+$/.test(photoId)) {
  root.render(<main className="cms-editor-message"><h1>No photograph chosen</h1><p><a href="/admin/photography/">Back to the CMS</a> and use “Edit in QuangEdit”.</p></main>);
} else {
  root.render(<React.StrictMode><EditorApp host={createCmsHost(photoId)} /></React.StrictMode>);
}
