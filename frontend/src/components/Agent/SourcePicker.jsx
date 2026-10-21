import React from 'react';
import { Icon } from '../ui';

function Chip({ selected, locked, icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={locked ? undefined : onClick}
      aria-pressed={selected}
      disabled={locked}
      title={locked ? 'Always included here' : selected ? 'Click to leave out' : 'Click to include'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition ${
        selected
          ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
      } ${locked ? 'cursor-default' : ''}`}
    >
      <Icon name={selected ? 'check' : icon} className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// Chooses which tables and documents the AI may use. `value` is { fileIds, documentIds }.
// A locked id (the table or document whose page this is) is always included.
function SourcePicker({ files, documents, value, onChange, lockedFileId, lockedDocumentId }) {
  const readyFiles = files.filter((f) => !f.status || f.status === 'ready');
  const allSelected =
    value.fileIds.length === readyFiles.length && value.documentIds.length === documents.length;
  const setAll = (on) =>
    onChange({
      fileIds: on ? readyFiles.map((f) => f.id) : lockedFileId ? [lockedFileId] : [],
      documentIds: on ? documents.map((d) => d.id) : lockedDocumentId ? [lockedDocumentId] : [],
    });

  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-4 mb-4"
      data-testid="source-picker"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-slate-900">
          Answer using
          <span className="ml-2 text-xs font-normal text-slate-500">
            {value.fileIds.length} table(s), {value.documentIds.length} document(s) selected
          </span>
        </p>
        {readyFiles.length + documents.length > 1 && (
          <button
            type="button"
            onClick={() => setAll(!allSelected)}
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        )}
      </div>
      {readyFiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs text-slate-500 w-20">Tables</span>
          {readyFiles.map((f) => (
            <Chip
              key={f.id}
              icon="table"
              label={f.original_filename}
              selected={value.fileIds.includes(f.id)}
              locked={f.id === lockedFileId}
              onClick={() => onChange({ ...value, fileIds: toggle(value.fileIds, f.id) })}
            />
          ))}
        </div>
      )}
      {documents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 w-20">Documents</span>
          {documents.map((d) => (
            <Chip
              key={d.id}
              icon="file"
              label={d.filename}
              selected={value.documentIds.includes(d.id)}
              locked={d.id === lockedDocumentId}
              onClick={() => onChange({ ...value, documentIds: toggle(value.documentIds, d.id) })}
            />
          ))}
        </div>
      )}
      {readyFiles.length === 0 && documents.length === 0 && (
        <p className="text-sm text-slate-500">Upload a CSV or a document first.</p>
      )}
    </div>
  );
}

export default SourcePicker;
