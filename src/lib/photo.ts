// Фото блюда: сжимаем до ~800 px и JPEG, чтобы не раздувать память и копию данных.
export async function compressPhoto(file: Blob, max = 800, quality = 0.72): Promise<string> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
  } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w0 = (bmp as any).width as number, h0 = (bmp as any).height as number;
  const k = Math.min(1, max / Math.max(w0, h0));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
  cv.getContext("2d")!.drawImage(bmp as CanvasImageSource, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", quality);
}
