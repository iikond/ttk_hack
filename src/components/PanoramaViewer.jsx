import React, { useEffect, useRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';

export const PanoramaViewer = ({ panoramaUrl }) => {
    const viewerContainerRef = useRef(null);

    useEffect(() => {
        if (!viewerContainerRef.current) return;

        // Инициализация просмотрщика панорам
        const viewer = new Viewer({
            container: viewerContainerRef.current,
            panorama: panoramaUrl, // Ссылка на сшитую панораму (например, от бэкенда)
            plugins: [
                [MarkersPlugin, {
                    markers: [
                        {
                            id: 'stand-ttk',
                            position: { yaw: '0.45rad', pitch: '0.1rad' },
                            html: '<div style="background: red; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white;"></div>',
                            anchor: 'center',
                            tooltip: 'Стенд ТТК (Интерактивная зона)',
                        }
                    ]
                }]
            ]
        });

        // Получаем плагин маркеров для добавления новых точек на лету
        const markersPlugin = viewer.getPlugin(MarkersPlugin);

        // Клик по панораме для добавления нового POI (как прописано в ТЗ для организатора)
        const handleClick = ({ data }) => {
            console.log(`Новый POI на сферических координатах: Yaw=${data.yaw}, Pitch=${data.pitch}`);

            const markerId = 'marker_' + Date.now();
            markersPlugin.addMarker({
                id: markerId,
                position: { yaw: data.yaw, pitch: data.pitch },
                html: '<div style="background: #00ffcc; width: 14px; height: 14px; border-radius: 50%; border: 2px solid black;"></div>',
                anchor: 'center',
                tooltip: 'Новая точка интереса',
            });
        };

        viewer.addEventListener('click', handleClick);

        // Очистка при размонтировании компонента
        return () => {
            viewer.removeEventListener('click', handleClick);
            viewer.destroy();
        };
    }, [panoramaUrl]);

    return (
        <div
            ref={viewerContainerRef}
            style={{ width: '100%', height: '70vh', borderRadius: '12px', overflow: 'hidden' }}
        />
    );
};