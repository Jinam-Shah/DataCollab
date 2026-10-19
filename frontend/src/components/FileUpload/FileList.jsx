import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';

function FileList({ refresh, onFileSelect, onFileDelete }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadFiles();
  }, [refresh]);

  // Refresh when anyone in the workspace uploads, finishes loading or deletes a file.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const events = ['file:uploaded', 'file:ready', 'file:failed', 'file:deleted'];
    events.forEach((e) => socket.on(e, loadFiles));
    return () => events.forEach((e) => socket.off(e, loadFiles));
  }, []);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/files');
      setFiles(response.data.files);
      setError('');
    } catch (err) {
      console.error('Load files error:', err);
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (fileId) => {
    if (!window.confirm('Are you sure you want to delete this file?')) {
      return;
    }

    try {
      await api.delete(`/api/files/${fileId}`);

      // Notify parent that file was deleted
      if (onFileDelete) {
        onFileDelete(fileId);
      }

      loadFiles();
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete file');
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 text-center">Loading files...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-red-600 text-center">{error}</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 text-center">No files uploaded yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <h2 className="text-xl font-bold text-gray-900">Uploaded Files</h2>
      </div>

      <div className="divide-y">
        {files.map((file) => (
          <div
            key={file.id}
            className="p-4 hover:bg-gray-50 transition cursor-pointer"
            onClick={() => onFileSelect && onFileSelect(file)}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">{file.original_filename}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {file.status && file.status !== 'ready'
                    ? `Status: ${file.status}${file.error ? ` (${file.error})` : ''}`
                    : `${file.row_count} rows, ${file.column_count} columns`}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Uploaded by {file.username} on {formatDate(file.uploaded_at)}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">{formatFileSize(file.file_size)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(file.id);
                  }}
                  className="text-red-600 hover:text-red-800 font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default FileList;
