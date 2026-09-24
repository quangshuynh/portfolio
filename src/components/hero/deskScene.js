import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original procedural miniature: metres are illustrative, not product CAD dimensions.
export function createDeskScene() {
  const scene = new THREE.Scene();
  const batches = new Map();
  const textures = [];
  const materials = [];
  const material = (color, map) => {
    const m = new THREE.MeshLambertMaterial({ color, map });
    materials.push(m);
    return m;
  };
  const texture = (width, height, draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    textures.push(t);
    return t;
  };
  const ink = material('#171f25');
  const edge = material('#343f46');
  const silver = material('#b6bdba');
  const blue = material('#2468c9');
  const glass = material('#213747');
  const gold = material('#c19a51');
  const glow = new THREE.MeshBasicMaterial({ color: '#77c6b2' });
  materials.push(glow);
  function add(
    geometry,
    mat,
    position,
    scale = [1, 1, 1],
    rotation = [0, 0, 0],
  ) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    if (geometry.index) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed();
      indexed.dispose();
    }
    geometry.applyMatrix4(matrix);
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push(geometry);
  }
  const box = (mat, p, s, r) =>
    add(new THREE.BoxGeometry(1, 1, 1), mat, p, s, r);
  const cylinder = (mat, p, s, r) =>
    add(new THREE.CylinderGeometry(1, 1, 1, 16), mat, p, s, r);
  const plane = (mat, p, s, r) =>
    add(new THREE.PlaneGeometry(1, 1), mat, p, s, r);
  const top = [-Math.PI / 2, 0, 0];

  // Desk: inexpensive grain, dark edge and two understated legs.
  const wood = material(
    '#ffffff',
    texture(256, 128, (c, w, h) => {
      c.fillStyle = '#634331';
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        c.strokeStyle = i % 3 ? '#6d4a33' : '#583c2b';
        c.lineWidth = 0.6;
        const y = (i * 37) % h;
        c.beginPath();
        c.moveTo(0, y);
        c.bezierCurveTo(80, y + 3, 180, y - 3, w, y + 1);
        c.stroke();
      }
    }),
  );
  box(wood, [0, 0, 0], [8.3, 0.22, 3.5]);
  box(ink, [-3.5, -0.38, 0], [0.16, 0.66, 2.7]);
  box(ink, [3.5, -0.38, 0], [0.16, 0.66, 2.7]);
  const shadow = material('#292521');
  for (const [x, z, w, d] of [
    [-2.15, -1.1, 0.7, 0.7],
    [1.78, -0.7, 0.7, 0.7],
    [2.95, -0.1, 1.5, 2],
    [-2.9, 1.05, 1, 0.6],
    [-3.4, -0.9, 1.3, 0.65],
  ]) {
    plane(shadow, [x, 0.116, z], [w, d, 1], top);
  }

  function screenTexture(portrait) {
    return texture(portrait ? 192 : 384, portrait ? 320 : 216, (c, w, h) => {
      c.fillStyle = '#0b1821';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#21343b';
      c.fillRect(0, 0, w, 22);
      ['#d08783', '#d3b16b', '#7eb8a5'].forEach((color, i) => {
        c.fillStyle = color;
        c.beginPath();
        c.arc(11 + i * 13, 11, 3, 0, Math.PI * 2);
        c.fill();
      });
      c.fillStyle = '#38505c';
      c.fillRect(8, 33, portrait ? 20 : 55, h - 43);
      c.font = '10px monospace';
      c.fillStyle = '#bfdbd5';
      c.fillText(
        portrait ? 'capture / explore' : 'quang / workspace',
        portrait ? 36 : 76,
        45,
      );
      for (let row = 0; row < (portrait ? 24 : 13); row++) {
        const x = (portrait ? 36 : 76) + (row % 4) * 7;
        c.fillStyle = ['#75b6a0', '#799bb7', '#c2b58e'][row % 3];
        c.fillRect(
          x,
          59 + row * 9,
          24 + ((row * 19) % (portrait ? 75 : 175)),
          3,
        );
      }
    });
  }
  function monitor(x, y, width, height, portrait = false) {
    box(ink, [x, y, -0.82], [width, height, 0.12]);
    // Inexpensive rear casing detail, visible at the allowed rear-quarter view.
    for (const offset of [-0.2, 0, 0.2])
      box(edge, [x + offset, y + 0.24, -0.889], [0.12, 0.025, 0.015]);

    const display = new THREE.MeshBasicMaterial({
      map: screenTexture(portrait),
    });
    materials.push(display);
    plane(display, [x, y, -0.753], [width - 0.1, height - 0.12, 1]);
    box(
      glow,
      [x + width / 2 - 0.13, y - height / 2 + 0.035, -0.747],
      [0.025, 0.012, 0.01],
    );
  }
  monitor(-1.75, 1.95, 3, 1.69);
  monitor(0.72, 2.32, 1.69, 3, true);

  // Shared desk-clamped dual arm: each branch folds below the display before
  // rising to a small rear VESA plate. No individual feet occupy the desktop.
  box(ink, [-0.45, 0.03, -1.65], [0.42, 0.32, 0.28]);
  cylinder(edge, [-0.45, -0.2, -1.64], [0.045, 0.22, 0.045]);
  cylinder(ink, [-0.45, 0.78, -1.48], [0.08, 1.32, 0.08]);
  function armSegment(from, to) {
    const a = new THREE.Vector3(...from),
      b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const rotation = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      ),
    );
    box(
      edge,
      a.add(b).multiplyScalar(0.5).toArray(),
      [0.13, direction.length(), 0.16],
      [rotation.x, rotation.y, rotation.z],
    );
  }
  for (const [x, y, elbow] of [
    [-1.75, 1.95, -2.45],
    [0.72, 2.32, 1.28],
  ]) {
    const pivot = [-0.45, 0.65, -1.48];
    const joint = [elbow, 0.72, -1.18];
    armSegment(pivot, joint);
    armSegment(joint, [x, y, -1.0]);
    cylinder(ink, joint, [0.115, 0.18, 0.115]);
    box(ink, [x, y, -0.94], [0.34, 0.34, 0.1]);
  }

  // Stereo pair: shared 16-sided tapered body and a tiny repeating mesh texture.
  // Static blue material suggests illumination without adding lights or bloom.
  const speakerMesh = material(
    '#ffffff',
    texture(32, 32, (c, w, h) => {
      c.fillStyle = '#202a30';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#10171c';
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) c.fillRect(x + (y % 8 ? 2 : 0), y, 1, 2);
    }),
  );
  speakerMesh.map.wrapS = speakerMesh.map.wrapT = THREE.RepeatWrapping;
  speakerMesh.map.repeat.set(4, 2);
  const speakerBlue = new THREE.MeshBasicMaterial({ color: '#4d8fc9' });
  materials.push(speakerBlue);
  const speakerBody = new THREE.CylinderGeometry(0.23, 0.3, 0.28, 16);
  for (const [x, z] of [
    [-2.15, -1.1],
    [1.78, -0.7],
  ]) {
    cylinder(silver, [x, 0.155, z], [0.32, 0.055, 0.32]);
    cylinder(speakerBlue, [x, 0.195, z], [0.305, 0.025, 0.305]);
    add(speakerBody.clone(), speakerMesh, [x, 0.347, z]);
    cylinder(ink, [x, 0.495, z], [0.232, 0.02, 0.232]);
  }
  speakerBody.dispose();

  // Keyboard: one textured surface, not eighty individually drawn meshes.
  const keys = material(
    '#ffffff',
    texture(384, 144, (c, w, h) => {
      c.fillStyle = '#252d31';
      c.fillRect(0, 0, w, h);
      for (let row = 0; row < 5; row++)
        for (let col = 0; col < 15; col++) {
          if (row === 4 && col > 2 && col < 9) continue;
          const x = 5 + col * 25,
            y = 5 + row * 27;
          c.fillStyle = '#e8e9df';
          c.fillRect(x, y, row === 4 && col === 2 ? 170 : 21, 22);
          c.save();
          c.translate(x + 6, y + 9);
          c.rotate(((col % 3) - 1) * 0.2);
          c.fillStyle = ['#a05072', '#407e83', '#7b6eae', '#ae8650'][col % 4];
          c.fillRect(0, 0, 5, 3);
          c.restore();
        }
    }),
  );
  box(ink, [-1.45, 0.23, 0.63], [2.03, 0.18, 0.77]);
  plane(keys, [-1.45, 0.325, 0.63], [1.98, 0.73, 1], top);
  box(glow, [-1.45, 0.2, 1.02], [1.94, 0.018, 0.01]);
  box(ink, [0.49, 0.135, 0.57], [1.55, 0.04, 1.6]);
  box(edge, [0.49, 0.16, -0.1], [1.4, 0.04, 0.17]);
  add(
    new THREE.SphereGeometry(1, 16, 10),
    ink,
    [0.5, 0.28, 0.72],
    [0.23, 0.16, 0.36],
  );
  box(silver, [0.5, 0.432, 0.6], [0.036, 0.025, 0.1]);
  box(edge, [0.5, 0.427, 0.45], [0.014, 0.015, 0.18]);

  // PC: opaque smoked panel, baked fan rings and RGB bars; no transparency pass.
  box(ink, [2.9, 1.28, -0.35], [1.45, 2.3, 1.85]);
  box(edge, [2.9, 2.46, -0.35], [1.45, 0.07, 1.85]);
  const panel = new THREE.MeshBasicMaterial({
    map: texture(192, 256, (c, w, h) => {
      c.fillStyle = '#111c23';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#26323b';
      c.fillRect(14, 22, 110, 112);
      c.fillStyle = '#3d4952';
      c.fillRect(24, 145, 130, 25);
      for (let i = 0; i < 2; i++) {
        const x = 53 + i * 81,
          y = 78;
        const g = c.createRadialGradient(x, y, 7, x, y, 34);
        g.addColorStop(0, '#172630');
        g.addColorStop(0.6, '#243144');
        g.addColorStop(0.8, i ? '#776195' : '#4d9c97');
        g.addColorStop(1, '#14222b');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, 34, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#779686';
      c.fillRect(138, 115, 4, 52);
      c.fillStyle = '#ad7698';
      c.fillRect(149, 115, 4, 52);
      c.fillStyle = '#1e2a31';
      c.fillRect(8, 197, 176, 50);
      c.strokeStyle = '#34434b';
      c.beginPath();
      c.moveTo(8, 180);
      c.lineTo(173, 18);
      c.stroke();
    }),
  });
  materials.push(panel);
  plane(panel, [2.9, 1.28, 0.58], [1.28, 2.12, 1]);
  for (const z of [-0.95, -0.7, -0.45, -0.2, 0.05])
    box(edge, [3.633, 1.35, z], [0.01, 1.7, 0.035]);
  box(glow, [3.64, 2.13, 0.25], [0.014, 0.055, 0.055]);

  // Rear I/O panel and vent: the closed tower is coherent from either side.
  box(edge, [2.9, 1.18, -1.29], [0.86, 1.66, 0.025]);
  for (const y of [0.48, 0.58, 0.68])
    box(ink, [2.9, y, -1.309], [0.57, 0.035, 0.016]);
  cylinder(ink, [2.9, 1.6, -1.315], [0.26, 0.015, 0.26], [Math.PI / 2, 0, 0]);

  // Four static runs, including the left-to-right stereo interconnect. Cable
  // vertices are kept on/above the wood surface, with short rises at connectors.
  function cable(points) {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
    );
    const geometry = new THREE.TubeGeometry(curve, 12, 0.014, 4, false);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++)
      positions.setY(i, Math.max(0.111, positions.getY(i)));
    add(geometry, ink, [0, 0, 0]);
  }
  cable([
    [-1.45, 0.23, 0.24],
    [-1.65, 0.125, 0.04],
    [-1.5, 0.125, -1.25],
    [0.2, 0.125, -1.55],
    [2.35, 0.125, -1.53],
    [2.65, 0.36, -1.31],
  ]);
  cable([
    [0.49, 0.18, -0.16],
    [0.26, 0.125, -0.32],
    [0.3, 0.125, -1.25],
    [1.8, 0.125, -1.43],
    [2.82, 0.32, -1.31],
  ]);
  cable([
    [-2.15, 0.2, -1.3],
    [-2, 0.125, -1.54],
    [-0.7, 0.125, -1.6],
    [0.85, 0.125, -1.48],
    [1.78, 0.2, -0.95],
  ]);
  cable([
    [1.78, 0.2, -0.95],
    [1.8, 0.125, -1.22],
    [2.22, 0.125, -1.6],
    [3.08, 0.36, -1.31],
  ]);

  // Photography: small mirrorless camera with a stepped lens and visible glass.
  box(ink, [-2.98, 0.44, 1.05], [0.69, 0.48, 0.38]);
  box(edge, [-3.15, 0.48, 1.05], [0.2, 0.49, 0.43]);
  box(ink, [-2.96, 0.73, 1.03], [0.26, 0.15, 0.25]);
  cylinder(silver, [-2.78, 0.71, 1.04], [0.075, 0.055, 0.075]);
  cylinder(edge, [-2.95, 0.44, 1.32], [0.22, 0.26, 0.22], [Math.PI / 2, 0, 0]);
  cylinder(ink, [-2.95, 0.44, 1.49], [0.19, 0.12, 0.19], [Math.PI / 2, 0, 0]);
  cylinder(
    glass,
    [-2.95, 0.44, 1.555],
    [0.145, 0.008, 0.145],
    [Math.PI / 2, 0, 0],
  );

  // Blue 22B-inspired display coupe: box arches, gold wheels, scoop and rear wing.
  const cx = -3.4,
    cy = 0.29,
    cz = -0.9;
  box(blue, [cx, cy, cz], [1.22, 0.24, 0.53]);
  const cabin = new THREE.Shape();
  cabin.moveTo(-0.36, 0);
  cabin.lineTo(-0.23, 0.24);
  cabin.lineTo(0.17, 0.24);
  cabin.lineTo(0.37, 0);
  cabin.closePath();
  add(
    new THREE.ExtrudeGeometry(cabin, { depth: 0.43, bevelEnabled: false }),
    glass,
    [cx - 0.06, cy + 0.12, cz - 0.215],
  );
  box(blue, [cx - 0.09, cy + 0.37, cz], [0.43, 0.035, 0.45]);
  box(blue, [cx + 0.33, cy + 0.15, cz], [0.16, 0.065, 0.18]);
  box(blue, [cx - 0.51, cy + 0.27, cz], [0.09, 0.05, 0.67]);
  for (const z of [-0.22, 0.22])
    box(blue, [cx - 0.51, cy + 0.19, cz + z], [0.035, 0.16, 0.03]);
  for (const x of [-0.37, 0.37])
    for (const z of [-0.28, 0.28]) {
      cylinder(
        ink,
        [cx + x, cy - 0.06, cz + z],
        [0.14, 0.08, 0.14],
        [Math.PI / 2, 0, 0],
      );
      cylinder(
        gold,
        [cx + x, cy - 0.06, cz + z * 1.17],
        [0.083, 0.014, 0.083],
        [Math.PI / 2, 0, 0],
      );
    }
  for (const z of [-0.17, 0.17])
    box(silver, [cx + 0.615, cy + 0.035, cz + z], [0.015, 0.06, 0.1]);
  box(ink, [cx + 0.619, cy - 0.025, cz], [0.014, 0.055, 0.15]);

  // Static material batches keep draw calls bounded as the object detail grows.
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    scene.add(new THREE.Mesh(merged, mat));
  }
  scene.add(new THREE.HemisphereLight('#d9e7ed', '#6b4a36', 2.2));
  const key = new THREE.DirectionalLight('#ffe2be', 2.5);
  key.position.set(-3, 7, 5);
  scene.add(key);
  return {
    scene,
    dispose() {
      scene.traverse((o) => o.geometry?.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}

export function frameDesk(camera, width, height) {
  const mobile = window.matchMedia('(max-width: 620px)').matches;
  const tablet = !mobile && window.matchMedia('(max-width: 1100px)').matches;
  const compact =
    !mobile && !tablet && window.matchMedia('(max-height: 820px)').matches;
  const aspect = width / height;
  const span = Math.max(mobile ? 6.5 : tablet ? 6.4 : 6.2, 10.4 / aspect);
  camera.left = (-span * aspect) / 2;
  camera.right = (span * aspect) / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.position.set(
    mobile ? 4.5 : tablet ? 4 : 5,
    mobile ? 7.4 : tablet ? 6.6 : compact ? 5.8 : 5.3,
    mobile ? 11.5 : 10,
  );
  camera.lookAt(0, 1.35, 0);
  camera.updateProjectionMatrix();
  return camera.position.clone();
}
