import { useState } from 'react';
import { Header } from './components/Header';
import { ShapeCollage } from './views/ShapeCollage';
import { GridCollage } from './views/GridCollage';
import { FlipbookMaker } from './views/FlipbookMaker';

export type Mode = 'shape' | 'grid' | 'flipbook';

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
      ) : mode === 'grid' ? (
        <GridCollage
          onExportRequest={setExportOpen}
          exportOpen={exportOpen}
          onPhotoCountChange={setPhotoCount}
        />
      ) : (
        <FlipbookMaker
          onPhotoCountChange={setPhotoCount}
          onExportRequest={setExportOpen}
          exportOpen={exportOpen}
        />
      )}
    </div>
  );
}
