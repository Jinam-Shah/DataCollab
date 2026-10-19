// Bundle Monaco with the app instead of loading it from a CDN at runtime. Only the core editor
// and SQL highlighting are included, which keeps the bundle smaller than the full package.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/sql/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
