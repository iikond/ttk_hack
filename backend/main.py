# main.py
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import base64
import uuid
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/panorama/stitch")
async def stitch_panorama(files: list[UploadFile] = File(...)):
    images = []

    for file in files:
        contents = await file.read()
        np_arr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is not None:
            images.append(img)

    if len(images) < 2:
        raise HTTPException(status_code=400, detail="Для сшивки нужно минимум 2 кадра")

    # Создаем сшиватель OpenCV
    stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    status, stitched = stitcher.stitch(images)

    if status != cv2.Stitcher_OK:
        # Если авто-сшивка OpenCV не справилась из-за недостаточного перекрытия,
        # возвращаем клиенту ошибку или fallback-коллаж
        raise HTTPException(status_code=422, detail=f"Ошибка сшивки (Код: {status}). Сделайте снимки с большим перекрытием.")

    # Сохраняем результат в WebP / JPEG
    out_filename = f"panorama_{uuid.uuid4().hex[:8]}.webp"
    os.makedirs("uploads", exist_ok=True)
    out_path = os.path.join("uploads", out_filename)

    cv2.imwrite(out_path, stitched, [cv2.IMWRITE_WEBP_QUALITY, 85])

    return {
        "status": "success",
        "panorama_url": f"/uploads/{out_filename}"
    }