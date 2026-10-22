import { useRef, useState } from 'react';
import { uploadFile } from '../api.js';

const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const STATUS_TEXT = {
  queued: 'Waiting',
  uploading: 'Uploading',
  processing: 'Generating previews',
  done: 'Added as a draft',
  duplicate: 'Already in the workspace',
  error: 'Failed',
};

/**
 * Uploads run one at a time so each file shows its own progress and error. Failed files
 * stay in the list with a retry button; a retried file that already arrived is reported
 * as a duplicate rather than stored twice.
 */
export default function UploadPanel({ open, onClose, beforeUpload, onUploaded, onSessionExpired }) {
  const [items, setItems] = useState([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const running = useRef(false);
  const queue = useRef([]);

  const update = (key, fields) => setItems((list) => list.map((item) => (item.key === key ? { ...item, ...fields } : item)));

  async function drain() {
    if (running.current) return;
    running.current = true;
    await beforeUpload();
    while (queue.current.length) {
      const item = queue.current.shift();
      update(item.key, { status: 'uploading', progress: 0, message: '' });
      try {
        const result = await uploadFile(item.file, (progress) => update(item.key, { progress, status: progress >= 1 ? 'processing' : 'uploading' }));
        update(item.key, { status: result.duplicate ? 'duplicate' : 'done', progress: 1, id: result.id });
        onUploaded(result);
      } catch (error) {
        if (error.status === 401) onSessionExpired();
        update(item.key, { status: 'error', message: error.message });
      }
    }
    running.current = false;
  }

  function add(files) {
    const added = [...files].map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, name: file.name, size: file.size, status: 'queued', progress: 0 }));
    setItems((list) => [...added, ...list]);
    queue.current.push(...added);
    drain();
  }

  function retry(item) {
    update(item.key, { status: 'queued', message: '' });
    queue.current.push(item);
    drain();
  }

  if (!open) return null;
  return (
    <div className="cms-upload" role="dialog" aria-modal="false" aria-label="Upload photographs">
      <header className="cms-details-head">
        <h2>Upload</h2>
        <button type="button" className="cms-icon-button" onClick={onClose} aria-label="Close uploads">×</button>
      </header>
      <div
        className={`cms-dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); add(event.dataTransfer.files); }}
      >
        <p>Drop JPEG, PNG or WebP files here</p>
        <button type="button" className="cms-button cms-button--primary" onClick={() => input.current.click()}>Choose files</button>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
        <p className="cms-field-hint">Uploads stay private in the CMS workspace on this computer. They become drafts; nothing is public until you publish and merge.</p>
      </div>
      {items.length > 0 && (
        <ul className="cms-upload-list" aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className={`cms-upload-item is-${item.status}`}>
              <span className="cms-upload-name">{item.name}</span>
              <span className="cms-upload-status">{STATUS_TEXT[item.status]}{item.id && item.status !== 'error' ? ` · ${item.id}` : ''}</span>
              <progress max="1" value={item.progress} aria-label={`${item.name} upload progress`} />
              {item.message && <span className="cms-upload-error">{item.message}</span>}
              {item.status === 'error' && <button type="button" className="cms-link" onClick={() => retry(item)}>Retry</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
