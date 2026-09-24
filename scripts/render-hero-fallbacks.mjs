import { send, evaluate, pause, close } from './hero-browser-session.mjs';
import sharp from 'sharp';
await send('Emulation.setDeviceMetricsOverride', {
  width: 1200,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', {
  url: process.env.HERO_DEV_URL || 'http://localhost:5173/',
});
await pause(1000);
for (const [name, width, height, viewportWidth, viewportHeight] of [
  ['desktop', 1000, 440, 1440, 900],
  ['compact', 1000, 440, 1366, 768],
  ['tablet', 900, 450, 1024, 768],
  ['mobile', 500, 375, 390, 844],
]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: viewportWidth < 621,
  });
  const data = await evaluate(
    `(async()=>{const {mountDeskScene}=await import('/src/components/hero/interactiveHeroScene.js');const h=document.createElement('div');h.style.cssText='position:fixed;top:0;left:0;width:${width}px;height:${height}px';document.body.append(h);return await new Promise((resolve,reject)=>{const instance=mountDeskScene(h,{onReady:()=>{const data=h.querySelector('canvas').toDataURL('image/png');setTimeout(()=>{instance.dispose();h.remove();resolve(data)},0)},onError:()=>reject(Error('WebGL failed'))});instance.setActive(true)})})()`,
  );
  await sharp(Buffer.from(data.split(',')[1], 'base64'))
    .webp({ quality: 85, effort: 6 })
    .toFile(`public/hero/desk-${name}.webp`);
}
await close();
