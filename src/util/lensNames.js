// Camera-reported names stay in EXIF and generated metadata. Apply aliases when displaying them.
const LENS_DISPLAY_NAMES = new Map([
  ['E 28-75mm F2.8 A063', 'Tamron 28-75mm F/2.8 Di III VXD G2'],
]);

export function formatLensName(lens) {
  return LENS_DISPLAY_NAMES.get(lens) ?? lens;
}
