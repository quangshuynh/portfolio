import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { send, evaluate, pause, close } from './hero-browser-session.mjs';

const output = process.env.HERO_CHECK_OUTPUT || 'docs/hero-scroll-music';
try {
  await mkdir(output, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', {
    url: process.env.HERO_DEV_URL || 'http://localhost:5173',
  });
  await pause(1500);
  await evaluate(`(async()=>{
    const {mountDeskScene}=await import('/src/components/hero/interactiveHeroScene.js');
    const host=document.createElement('div');
    host.id='music-capture';
    host.style.cssText='position:fixed;z-index:9999;top:0;left:0;width:1600px;height:704px;background:#142128';
    document.body.append(host);
    window.captureScene=mountDeskScene(host,{onReady(){},onError(){throw Error('WebGL failed')}});
    captureScene.setActive(true);
  })()`);
  for (const [name, key, count] of [
    ['front', 'Escape', 1],
    ['left', 'ArrowLeft', 6],
    ['right', 'ArrowRight', 6],
  ]) {
    await evaluate(
      `document.querySelector('#music-capture').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`,
    );
    for (let i = 0; i < count; i++)
      await evaluate(
        `document.querySelector('#music-capture').dispatchEvent(new KeyboardEvent('keydown',{key:'${key}'}))`,
      );
    await pause(1200);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 1600, height: 704, scale: 1 },
    });
    const bytes = Buffer.from(data, 'base64');
    await sharp(bytes)
      .webp({ quality: 90 })
      .toFile(`${output}/music-${name}.webp`);
    if (name === 'front')
      await sharp(bytes)
        .extract({ left: 800, top: 48, width: 235, height: 370 })
        .webp({ quality: 95 })
        .toFile(`${output}/right-monitor-close.webp`);
  }
} finally {
  await close();
}
