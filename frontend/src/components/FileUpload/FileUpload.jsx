import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import { Icon, Spinner } from '../ui';

// CSV upload. Small files load during the request; large ones are processed in the background
// and report progress over the socket.
function FileUpload({ onUploadSuccess }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  // Set while a large file is being loaded by the background worker.
  const [job, setJob] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !job) return undefined;
    const onProgress = (p) => {
      if (p.fileId === job.fileId) setJob((j) => ({ ...j, ...p }));
    };
    const onReady = async (e) => {
      if (e.fileId !== job.fileId) return;
      setJob(null);
      const response = await api.get(`/api/files/${e.fileId}`);
      if (onUploadSuccess) onUploadSuccess(response.data.file);
    };
    const onFailed = (e) => {
      if (e.fileId !== job.fileId) return;
      setJob(null);
      setError(`Processing failed: ${e.error}`);
    };
    socket.on('file:progress', onProgress);
    socket.on('file:ready', onReady);
    socket.on('file:failed', onFailed);
    return () => {
      socket.off('file:progress', onProgress);
      socket.off('file:ready', onReady);
      socket.off('file:failed', onFailed);
    };
  }, [job, onUploadSuccess]);

  const pick = (f) => {
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.csv')) {
      setFile(f);
      setError('');
    } else {
      setError('Please upload a CSV file');
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await api.post('/api/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (response.status === 202) {
        setJob({ fileId: response.data.file.id, phase: 'queued', percent: 0 });
      } else if (onUploadSuccess) {
        onUploadSuccess(response.data.file);
      }
      setFile(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg mb-3">
          {error}
        </div>
      )}

      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center transition ${
          dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={(e) => {
          handleDrag(e);
          setDragActive(false);
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
          className="hidden"
          id="file-input"
        />
        {file ? (
          <div className="text-sm">
            <p className="font-medium text-slate-900 truncate">{file.name}</p>
            <p className="text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div className="text-sm text-slate-600">
            <Icon name="upload" className="w-6 h-6 mx-auto text-slate-400 mb-1" />
            Drop a CSV here or{' '}
            <label
              htmlFor="file-input"
              className="text-indigo-600 font-medium cursor-pointer hover:underline"
            >
              Browse files
            </label>
          </div>
        )}
      </div>

      {file && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300"
          >
            {uploading && <Spinner />}
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
          <button
            onClick={() => setFile(null)}
            disabled={uploading}
            className="px-4 bg-white border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      )}

      {job && (
        <div className="mt-3" data-testid="upload-progress">
          <p className="text-xs text-slate-600 mb-1">
            Processing in background: {job.phase}
            {job.totalRows ? ` (${job.rowsLoaded} / ${job.totalRows} rows)` : ''}
          </p>
          <div className="w-full bg-slate-200 rounded h-1.5">
            <div
              className="bg-indigo-600 h-1.5 rounded transition-all"
              style={{ width: `${job.percent || 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUpload;
