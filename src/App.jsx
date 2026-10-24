import React, { useState } from 'react';
import { CapturePanorama } from './components/CapturePanorama';
import { PanoramaViewer } from './components/PanoramaViewer';

function App() {
    const [isCapturing, setIsCapturing] = useState(false);
    const [panoramaUrl, setPanoramaUrl] = useState(null);

    return (
        <div style={{ padding: 20, fontFamily: 'sans-serif', background: '#111', color: '#fff', minHeight: '100vh' }}>
            <h1>🗺️ ТТК: Создание и просмотр панорам</h1>

            {isCapturing ? (
                <CapturePanorama onFramesCaptured={(frames) => {
                    setIsCapturing(false);
                    // Здесь отправка кадров на бэкенд, после чего меняем state на URL сшитой панорамы
                    // setPanoramaUrl('http://localhost:8000/uploads/...');
                }} />
            ) : (
                <div>
                    {!panoramaUrl ? (
                        <button
                            onClick={() => setIsCapturing(true)}
                            style={{ padding: '12px 24px', background: '#eb140a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 'bold' }}
                        >
                            📸 Снять панораму на телефон
                        </button>
                    ) : (
                        <div>
                            <h3>Просмотр готовой панорамы и расстановка точек:</h3>
                            <PanoramaViewer panoramaUrl={panoramaUrl} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default App;