// Pixels of CMS images for the watermark previews and placement check (browser only).

/** The full-size frame the mark is laid out for: the photo's proportions at a 6000 px long edge (originals are not read here). */
export const nominalFrame = (width, height) => {
  const k = 6000 / Math.max(width, height);
  return { width: Math.round(width * k), height: Math.round(height * k) };
};

export function loadPixels(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => reject(new Error('The gallery image could not be read.'));
    image.src = url;
  });
}
