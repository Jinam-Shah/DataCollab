import React, { useState } from 'react';
import api from '../../services/api';

function TextToSQL({ selectedFile, onQueryGenerated }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!question.trim()) {
      setError('Please enter a question');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/ai/text-to-sql', {
        question: question,
        fileId: selectedFile.id,
      });

      if (response.data.success) {
        if (onQueryGenerated) {
          onQueryGenerated(response.data.query);
        }
        setQuestion('');
        setError('');
      }
    } catch (err) {
      console.error('AI error:', err);
      setError(err.response?.data?.error || 'Failed to generate SQL');
    } finally {
      setLoading(false);
    }
  };

  const sampleQuestions = [
    'Show all records',
    'Count total rows',
    'Show unique departments',
    'Find average salary',
    'Show top 5 highest salaries',
  ];

  return (
    <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-200">
      <h3 className="font-medium text-gray-900 mb-3">AI-Powered Query Generator</h3>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded mb-3 text-sm">
          {error}
        </div>
      )}

      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Ask a question in plain English:
        </label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !loading) {
              handleGenerate();
            }
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Show employees with salary above 80000"
          disabled={loading}
        />
      </div>

      <div className="mb-3">
        <p className="text-xs text-gray-600 mb-2">Try these examples:</p>
        <div className="flex flex-wrap gap-2">
          {sampleQuestions.map((q, index) => (
            <button
              key={index}
              onClick={() => setQuestion(q)}
              disabled={loading}
              className="px-2 py-1 bg-white text-gray-700 rounded text-xs hover:bg-gray-100 border border-gray-300 transition"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !question.trim()}
        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
      >
        {loading ? 'Generating SQL...' : 'Generate SQL Query'}
      </button>
    </div>
  );
}

export default TextToSQL;
