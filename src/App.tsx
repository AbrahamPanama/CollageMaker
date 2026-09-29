import { useState } from 'react';
import { Header } from './components/Header';
import { ShapeCollage } from './views/ShapeCollage';
import { GridCollage } from './views/GridCollage';
import { FlipbookMaker } from './views/FlipbookMaker';
import { LegoView } from './views/LegoView';

export type Mode = 'shape' | 'grid' | 'flipbook' | 'lego';

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
      ) : mode === 'flipbook' ? (
        <FlipbookMaker
          onPhotoCountChange={setPhotoCount}
          onExportRequest={setExportOpen}
          exportOpen={exportOpen}
        />
      ) : (
        <LegoView
          onPhotoCountChange={setPhotoCount}
          onExportRequest={setExportOpen}
          exportOpen={exportOpen}
        />
      )}
    </div>
  );
}
