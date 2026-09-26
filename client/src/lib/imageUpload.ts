// Resizes and compresses a user-uploaded image in the browser before it's
// sent to the backend, so custom invite artwork stays small enough to store
// as a data URI in SQLite without needing a separate file-upload pipeline.
const MAX_DIMENSION = 1000;
const JPEG_QUALITY = 0.82;

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.onerror = () => reject(new Error("Could not read that image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/** Separate limits for the saved pre-payment artwork flow; do not alter legacy uploads. */
export async function readCustomerArtworkFile(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10_000_000)
    throw new Error('Choose a JPG or PNG smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    if (Math.min(img.naturalWidth, img.naturalHeight) < 512)
      throw new Error('Choose a clearer image with both sides at least 512 pixels.');
    const scale = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    if (Math.min(canvas.width, canvas.height) < 512) throw new Error('Choose a less narrow image with both sides at least 512 pixels.');
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image upload is unavailable in this browser.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.95);
    if (result.length > 3_333_360) throw new Error('Choose a smaller or less detailed image.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}
