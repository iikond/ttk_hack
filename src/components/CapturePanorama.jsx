// CapturePanorama.jsx
import React, { useRef, useState, useEffect } from 'react';

export const CapturePanorama = ({ onFramesCaptured }) => {
    const videoRef = useRef(null);
    const [yaw, setYaw] = useState(0);
    const [capturedFrames, setCapturedFrames] = useState([]);
    const [targetYaw, setTargetYaw] = useState(0); // Следующий целевой угол (например, каждые 45°)
    const [guideText, setGuideText] = useState('Держите телефон ровно и начните поворот');

    // Инициализация камеры
    useEffect(() => {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then((stream) => { if (videoRef.current) videoRef.current.srcObject = stream; })
            .catch((err) => console.error("Ошибка доступа к камере:", err));

        // Отслеживание гироскопа
        const handleOrientation = (event) => {
            const alpha = event.alpha; // Поворот вокруг оси Z (0..360)
            if (alpha !== null) {
                setYaw(Math.round(alpha));
            }
        };

        window.addEventListener('deviceorientation', handleOrientation);
        return () => window.removeEventListener('deviceorientation', handleOrientation);
    }, []);

    // Автоматический или ручной захват кадра
    const captureFrame = () => {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0);

        const imageData = canvas.toDataURL('image/jpeg', 0.85);
        const newFrames = [...capturedFrames, { yaw, image: imageData }];
        setCapturedFrames(newFrames);

        // Подсказка следующего шага
        if (newFrames.length >= 8) {
            setGuideText('Отлично! Все кадры собраны. Отправляем на сшивку...');
            onFramesCaptured(newFrames);
        } else {
            setTargetYaw((targetYaw + 45) % 360);
            setGuideText(`Повернитесь правее на ${45}° (${newFrames.length}/8 кадров)`);
        }
    };

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>
            <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

            {/* HUD-интерфейс подсказок */}
            <div style={{
                position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '12px 24px', borderRadius: 20, textAlign: 'center'
            }}>
                <p style={{ margin: 0, fontWeight: 'bold' }}>{guideText}</p>
                <small>Текущий угол: {yaw}° | Снято: {capturedFrames.length}/8</small>
            </div>

            {/* Кнопка захвата */}
            <button
                onClick={captureFrame}
                style={{
                    position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
                    width: 70, height: 70, borderRadius: '50%', border: '4px solid #fff', background: '#eb140a', cursor: 'pointer'
                }}
            />
        </div>
    );
};