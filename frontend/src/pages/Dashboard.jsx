import React, { useState } from 'react';
import { getUser, logout } from '../utils/auth';
import FileUpload from '../components/FileUpload/FileUpload';
import FileList from '../components/FileUpload/FileList';
import api from '../services/api';
import QueryEditor from '../components/QueryEditor/QueryEditor';
import ChatSidebar from '../components/Chat/ChatSidebar';
import { connectSocket, disconnectSocket, initSocket } from '../services/socket';

function Dashboard() {
  const user = getUser();
  const [refreshFiles, setRefreshFiles] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);

  React.useEffect(() => {
    initSocket();
    connectSocket();

    return () => {
      disconnectSocket();
    };
  }, []);

  const handleUploadSuccess = (file) => {
    console.log('File uploaded:', file);
    setRefreshFiles((prev) => prev + 1);
    setSelectedFile(file);
  };

  const handleFileSelect = async (file) => {
    try {
      const response = await api.get(`/api/files/${file.id}`);
      setSelectedFile(response.data.file);
    } catch (err) {
      console.error('Error loading file details:', err);
      setSelectedFile(file);
    }
  };

  const handleFileDelete = (deletedFileId) => {
    // If the deleted file is currently selected, clear the preview
    if (selectedFile && selectedFile.id === deletedFileId) {
      setSelectedFile(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">DataCollab</h1>
            <p className="text-sm text-gray-500">Workspace: {user?.workspaceId || 'default'}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-700">Welcome, {user?.username}!</span>
            <button
              onClick={logout}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div>
            <FileUpload onUploadSuccess={handleUploadSuccess} />
          </div>

          <div>
            <FileList
              refresh={refreshFiles}
              onFileSelect={handleFileSelect}
              onFileDelete={handleFileDelete}
            />
          </div>
          <div className="lg:row-span-2">
            <div className="sticky top-8 h-[600px]">
              <ChatSidebar />
            </div>
          </div>
        </div>

        {selectedFile && (
          <div className="mt-6 bg-white rounded-lg shadow p-6">
            <QueryEditor selectedFile={selectedFile} />
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              File Details: {selectedFile.originalFilename || selectedFile.original_filename}
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-sm text-gray-600">Rows</p>
                <p className="text-2xl font-bold text-gray-900">
                  {selectedFile.rowCount || selectedFile.row_count}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Columns</p>
                <p className="text-2xl font-bold text-gray-900">
                  {selectedFile.columnCount || selectedFile.column_count}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Table Name</p>
                <p className="text-sm font-mono text-gray-900 mt-1">
                  {selectedFile.tableName || selectedFile.table_name}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">File ID</p>
                <p className="text-2xl font-bold text-gray-900">{selectedFile.id}</p>
              </div>
            </div>

            {selectedFile.columns && (
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Columns:</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedFile.columns.map((col, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                    >
                      {col.name} ({col.type})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedFile.preview && selectedFile.preview.length > 0 && (
              <div className="mt-4">
                <h3 className="font-medium text-gray-900 mb-2">Preview (first 10 rows):</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        {Object.keys(selectedFile.preview[0]).map((key) => (
                          <th
                            key={key}
                            className="px-4 py-2 border-b text-left text-sm font-medium text-gray-700"
                          >
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedFile.preview.map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-gray-50">
                          {Object.values(row).map((value, colIndex) => (
                            <td key={colIndex} className="px-4 py-2 border-b text-sm text-gray-900">
                              {value !== null && value !== undefined ? String(value) : 'null'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
