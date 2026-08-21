import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Pestaña "Inspeccionar/Editar código" (SPEC §5.1).
 *
 * Se carga por separado (lazy) desde PreviewPanel: CodeMirror pesa y el docente
 * que sólo usa el chat no tiene por qué descargarlo.
 */
export default function CodeEditor({ value, onChange }: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={oneDark}
      extensions={[html()]}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
      className="h-full text-sm"
    />
  );
}
