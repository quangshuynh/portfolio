import { createDeskScene } from './deskScene';

test('portrait screen bakes music beneath code without another texture or mesh', () => {
  const drawings = [];
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(function () {
      const drawing = { canvas: this, operations: [] };
      drawings.push(drawing);
      return new Proxy(
        {},
        {
          get(target, key) {
            if (key === 'createRadialGradient')
              return () => ({ addColorStop() {} });
            return (
              target[key] ??
              ((...args) =>
                drawing.operations.push({
                  kind: key,
                  args,
                  color: target.fillStyle,
                }))
            );
          },
          set(target, key, value) {
            target[key] = value;
            return true;
          },
        },
      );
    });
  let desk;
  try {
    desk = createDeskScene();
    expect(drawings).toHaveLength(6);
    const portrait = drawings.find(
      (d) => d.canvas.width === 192 && d.canvas.height === 320,
    );
    const title = portrait.operations.find(
      (o) => o.kind === 'fillText' && o.args[0] === 'Evening drive',
    );
    const artist = portrait.operations.find(
      (o) => o.kind === 'fillText' && o.args[0] === 'Studio notes',
    );
    expect(title.args[2]).toBeGreaterThan((320 * 2) / 3);
    expect(artist.args[2]).toBeGreaterThan(title.args[2]);
    expect(
      portrait.operations.some(
        (o) =>
          o.kind === 'fillText' &&
          o.args[0] === 'capture / explore' &&
          o.args[2] < (320 * 2) / 3,
      ),
    ).toBe(true);
    expect(
      portrait.operations.some(
        (o) => o.kind === 'arc' && o.color === '#1db954',
      ),
    ).toBe(true);
    const meshes = [];
    desk.scene.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
    expect(meshes).toHaveLength(15);
    expect(
      meshes.reduce(
        (sum, m) => sum + m.geometry.attributes.position.count / 3,
        0,
      ),
    ).toBe(2902);
  } finally {
    desk?.dispose();
    spy.mockRestore();
  }
});
