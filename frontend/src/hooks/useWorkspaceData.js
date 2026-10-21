import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { getSocket } from '../services/socket';

// Loads a workspace list and reloads it whenever one of `events` arrives on the socket,
// so every open browser in the workspace sees uploads and deletes without refreshing.
function useLiveList(url, key, events) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const res = await api.get(url);
      setItems(res.data[key]);
      setError('');
    } catch {
      setError('Could not load data from the server');
    } finally {
      setLoading(false);
    }
  }, [url, key]);

  useEffect(() => {
    reload();
    const socket = getSocket();
    if (!socket) return undefined;
    events.forEach((e) => socket.on(e, reload));
    return () => events.forEach((e) => socket.off(e, reload));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  return { items, loading, error, reload };
}

export function useFiles() {
  const { items, ...rest } = useLiveList('/api/files', 'files', [
    'file:uploaded',
    'file:ready',
    'file:failed',
    'file:deleted',
  ]);
  return { files: items, ...rest };
}

export function useDocuments() {
  const { items, ...rest } = useLiveList('/api/documents', 'documents', [
    'document:uploaded',
    'document:deleted',
  ]);
  return { documents: items, ...rest };
}
