import { useState } from 'react';
import { Header } from './components/Header';
import { ShapeCollage } from './views/ShapeCollage';
import { GridCollage } from './views/GridCollage';

type Mode = 'shape' | 'grid';

export function App() {
  const [mode, setMode] = useState<Mode>('shape');
  const [exportOpen, setExportOpen] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);

  return (
    <div className="cm-root">
      <Header
        mode={mode}
        onMode={setMode}
        photoCount={photoCount}
        onExport={() => setExportOpen(true)}
      />
      {mode === 'shape' ? (
        <ShapeCollage
          onExportRequest={setExportOpen}
          exportOpen={exportOpen}
          onPhotoCountChange={setPhotoCount}
        />
      ) : (
        <GridCollage
          onExportRequest={setExportOpen}
          exportOpen={exportOpen}
          onPhotoCountChange={setPhotoCount}
        />
      )}
    </div>
  );
}
