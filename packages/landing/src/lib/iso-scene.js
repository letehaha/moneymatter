const C = 0.866;
const S = 0.5;
const f = (n) => Math.round(n * 10) / 10;
const P = (x, y, z = 0) => [(x - y) * C, (x + y) * S - z];
const pts = (a) => a.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
const poly = (a, cls) => `<polygon class="${cls}" points="${pts(a)}"/>`;

const BASE = 16;
const TOP = BASE + 8;

const box = ({ x, y, z = 0, w, d, h, tone = '' }) => {
  const t = tone ? ` ${tone}` : '';
  return (
    poly([P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)], `fl${t}`) +
    poly([P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)], `fr${t}`) +
    poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], `ft${t}`)
  );
};

export const bars = (heights) =>
  heights.map((h, i) => box({ x: -122 + i * 21, y: 98, z: TOP, w: 13, d: 13, h, tone: i % 2 ? '' : 'ac' })).join('');

export const WORTH = [146100, 146900, 146650, 147900, 147700, 148672];
const SPARK_X = [14, 34, 54, 74, 94, 118];

/** @param {{ worth: number[] }} args */
export const sparkYs = ({ worth }) => {
  const lo = Math.min(...worth);
  const span = Math.max(...worth) - lo || 1;
  return worth.map((v) => 104 - ((v - lo) / span) * 36);
};

/** @param {{ ys: number[] }} args */
export const sparkLine = ({ ys }) => ys.map((y, i) => `${i ? 'L' : 'M'}${SPARK_X[i]} ${y.toFixed(1)}`).join('');

/**
 * @param {{ active?: string }} [args]
 * @returns {{ svg: string, finale: string }}
 */
export const buildIso = ({ active } = {}) => {
  const ground = ({ x = 0, y = 0, z = 0, inner }) => {
    const [px, py] = P(x, y, z);
    return `<g transform="matrix(${C} ${S} ${-C} ${S} ${f(px)} ${f(py)})">${inner}</g>`;
  };
  const faceLeft = ({ x, y, z, inner }) => {
    const [px, py] = P(x, y, z);
    return `<g transform="matrix(${C} ${S} 0 1 ${f(px)} ${f(py)})">${inner}</g>`;
  };
  const groundFlip = ({ x, y, z = 0, inner }) => {
    const [px, py] = P(x, y, z);
    return `<g transform="matrix(${C} ${-S} ${C} ${S} ${f(px)} ${f(py)})">${inner}</g>`;
  };
  const faceRight = ({ x, y, z, inner }) => {
    const [px, py] = P(x, y, z);
    return `<g transform="matrix(${C} ${-S} 0 1 ${f(px)} ${f(py)})">${inner}</g>`;
  };

  const rrect = ({ x, y, w, d, r }) => {
    const out = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= 6; i += 1) {
        const a = a0 + (Math.PI / 2) * (i / 6);
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    corner(x + w - r, y + d - r, 0);
    corner(x + r, y + d - r, Math.PI / 2);
    corner(x + r, y + r, Math.PI);
    corner(x + w - r, y + r, 1.5 * Math.PI);
    return out;
  };
  const disc = ({ x, y, r }) => {
    const out = [];
    for (let i = 0; i < 32; i += 1) {
      const a = (Math.PI * 2 * i) / 32;
      out.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
    }
    return out;
  };
  const prism = ({ outline, z = 0, h, tone = '' }) => {
    const top = outline.map(([gx, gy]) => P(gx, gy, z + h));
    let iMin = 0;
    let iMax = 0;
    top.forEach((p, i) => {
      if (p[0] < top[iMin][0]) iMin = i;
      if (p[0] > top[iMax][0]) iMax = i;
    });
    const n = top.length;
    const walk = (step) => {
      const chain = [];
      for (let i = iMax; ; i = (i + step + n) % n) {
        chain.push(top[i]);
        if (i === iMin) break;
      }
      return chain;
    };
    const a = walk(1);
    const b = walk(-1);
    const lowest = (c) => Math.max(...c.map((p) => p[1]));
    const front = lowest(a) > lowest(b) ? a : b;
    const skirt = [
      ...front,
      ...front
        .slice()
        .reverse()
        .map(([sx, sy]) => [sx, sy + h]),
    ];
    const t = tone ? ` ${tone}` : '';
    return poly(skirt, `fs${t}`) + poly(top, `ft${t}`);
  };

  const roofAlongY = ({ x0, x1, y0, y1, z, rise }) => {
    const xm = (x0 + x1) / 2;
    return (
      poly([P(x0, y0, z), P(x0, y1, z), P(xm, y1, z + rise), P(xm, y0, z + rise)], 'ft') +
      poly([P(x1, y0, z), P(x1, y1, z), P(xm, y1, z + rise), P(xm, y0, z + rise)], 'fr') +
      poly([P(x0, y1, z), P(x1, y1, z), P(xm, y1, z + rise)], 'fl')
    );
  };
  const roofAlongX = ({ x0, x1, y0, y1, z, rise }) => {
    const ym = (y0 + y1) / 2;
    return (
      poly([P(x0, y0, z), P(x1, y0, z), P(x1, ym, z + rise), P(x0, ym, z + rise)], 'ft') +
      poly([P(x0, y1, z), P(x1, y1, z), P(x1, ym, z + rise), P(x0, ym, z + rise)], 'fl') +
      poly([P(x1, y0, z), P(x1, y1, z), P(x1, ym, z + rise)], 'fr')
    );
  };

  const OBJECTS = {
    accounts: ({ x, y, z }) =>
      box({ x: x - 40, y: y - 30, z, w: 80, d: 60, h: 5 }) +
      box({ x: x - 34, y: y - 26, z: z + 5, w: 68, d: 42, h: 26 }) +
      [0, 1, 2, 3].map((i) => box({ x: x - 34 + i * 20.3, y: y + 18, z: z + 5, w: 7, d: 7, h: 26 })).join('') +
      box({ x: x - 38, y: y - 28, z: z + 31, w: 76, d: 56, h: 5 }) +
      roofAlongY({ x0: x - 38, x1: x + 38, y0: y - 28, y1: y + 28, z: z + 36, rise: 17 }),
    investments: ({ x, y, z }) =>
      [16, 28, 22, 46]
        .map((h, i) => box({ x: x - 38 + i * 19, y: y - 16, z, w: 14, d: 14, h, tone: i === 3 ? 'ac' : '' }))
        .join('') + prism({ outline: disc({ x: x + 4, y: y + 22, r: 11 }), z, h: 5, tone: 'ac' }),
    vehicles: ({ x, y, z }) =>
      box({ x: x - 38, y: y - 16, z: z + 5, w: 76, d: 32, h: 13 }) +
      box({ x: x - 22, y: y - 14, z: z + 18, w: 40, d: 28, h: 12 }) +
      faceLeft({
        x: x - 22,
        y: y + 14,
        z: z + 30,
        inner: '<rect class="ln" x="3" y="2.5" width="34" height="7" rx="1.5"/><path class="ln" d="M20 2.5v7"/>',
      }) +
      faceLeft({
        x: x - 38,
        y: y + 16,
        z: z + 18,
        inner: '<circle class="wheel" cx="16" cy="11.5" r="6.5"/><circle class="wheel" cx="60" cy="11.5" r="6.5"/>',
      }) +
      faceRight({
        x: x + 38,
        y: y + 16,
        z: z + 18,
        inner:
          '<rect class="ln" x="3" y="3" width="7" height="4" rx="1"/><rect class="ln" x="22" y="3" width="7" height="4" rx="1"/>',
      }),
    liabilities: ({ x, y, z }) =>
      box({ x: x - 16, y: y - 18, z, w: 44, d: 4, h: 56 }) +
      faceLeft({ x: x - 16, y: y - 14, z: z + 56, inner: '<path class="ln" d="M7 9h30M7 17h20"/>' }) +
      box({ x: x - 34, y: y + 4, z, w: 62, d: 5, h: 40 }) +
      faceLeft({
        x: x - 34,
        y: y + 9,
        z: z + 40,
        inner:
          '<rect class="bar ac" y="7" width="62" height="8"/><rect class="ln" x="7" y="22" width="11" height="9" rx="2"/><path class="ln" d="M26 31h28"/>',
      }),
    realestate: ({ x, y, z }) =>
      box({ x: x - 30, y: y - 26, z, w: 60, d: 48, h: 26 }) +
      faceLeft({
        x: x - 30,
        y: y + 22,
        z: z + 26,
        inner:
          '<rect class="ln" x="11" y="10" width="12" height="16"/><rect class="ln" x="34" y="8" width="15" height="10"/>',
      }) +
      roofAlongX({ x0: x - 34, x1: x + 34, y0: y - 30, y1: y + 26, z: z + 26, rise: 22 }),
    commodities: ({ x, y, z }) =>
      box({ x: x - 34, y: y - 12, z, w: 30, d: 20, h: 11 }) +
      box({ x: x + 2, y: y - 12, z, w: 30, d: 20, h: 11 }) +
      box({ x: x - 16, y: y - 12, z: z + 11, w: 30, d: 20, h: 11 }),
    pension: ({ x, y, z }) =>
      [
        { dx: -14, dy: -18, coins: 6 },
        { dx: 14, dy: -6, coins: 4 },
        { dx: -10, dy: 12, coins: 2 },
      ]
        .map(({ dx, dy, coins }) =>
          Array.from({ length: coins }, (_, i) =>
            prism({ outline: disc({ x: x + dx, y: y + dy, r: 11 }), z: z + i * 5, h: 5 }),
          ).join(''),
        )
        .join(''),
  };

  const HALF = 66;
  const PLATE = 10;
  const DOT_DUR = 4.4;
  // SVG paints in document order, so islands are listed back to front.
  const ISLANDS = [
    {
      key: 'investments',
      name: 'Investments',
      at: [-340, -150],
      phase: 1,
      wire: [
        [-274, -150],
        [-212, -150],
        [-212, -60],
        [-150, -60],
      ],
    },
    {
      key: 'accounts',
      name: 'Accounts',
      at: [-150, -340],
      phase: 0,
      wire: [
        [-150, -274],
        [-150, -212],
        [-60, -212],
        [-60, -150],
      ],
    },
    {
      key: 'liabilities',
      name: 'Liabilities',
      at: [-280, 260],
      phase: 2,
      wire: [
        [-214, 260],
        [-60, 260],
        [-60, 150],
      ],
    },
    {
      key: 'vehicles',
      name: 'Vehicles',
      at: [260, -280],
      phase: 3,
      wire: [
        [260, -214],
        [260, -60],
        [150, -60],
      ],
    },
    {
      key: 'realestate',
      name: 'Real estate',
      at: [20, 390],
      soon: true,
      wire: [
        [20, 324],
        [20, 150],
      ],
    },
    {
      key: 'pension',
      name: 'Pension',
      at: [390, 20],
      soon: true,
      wire: [
        [324, 20],
        [150, 20],
      ],
    },
    {
      key: 'commodities',
      name: 'Commodities',
      at: [285, 285],
      soon: true,
      wire: [
        [285, 219],
        [285, 100],
        [150, 100],
      ],
    },
  ];

  const route = (points) => {
    const r = 16;
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const [px, py] = points[i - 1];
      const [cx, cy] = points[i];
      const [nx, ny] = points[i + 1];
      d += ` L${cx + Math.sign(px - cx) * r} ${cy + Math.sign(py - cy) * r} Q${cx} ${cy} ${cx + Math.sign(nx - cx) * r} ${cy + Math.sign(ny - cy) * r}`;
    }
    const last = points[points.length - 1];
    return `${d} L${last[0]} ${last[1]}`;
  };

  const wire = ({ key, soon, phase, wire: points }) => {
    const d = route(points);
    const [sx, sy] = points[0];
    const [ex, ey] = points[points.length - 1];
    const delay = soon ? 0 : f((phase * DOT_DUR) / 4);
    const timing = `dur="${DOT_DUR}s" begin="${-delay}s" repeatCount="indefinite"`;
    const dot = soon
      ? ''
      : `<circle class="dot" r="4.5"><animateMotion ${timing} path="${d}"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.9;1" ${timing}/></circle>`;
    const feed = soon ? '' : ` data-dur="${DOT_DUR}" data-delay="${delay}"`;
    return `<g class="wire${soon ? ' soon' : ''}${key === active ? ' on' : ''}" data-key="${key}"${feed}>${ground({
      inner: `<path class="wire-line" d="${d}"/><circle class="port" cx="${sx}" cy="${sy}" r="4"/><circle class="port end" cx="${ex}" cy="${ey}" r="4"/>${dot}`,
    })}</g>`;
  };

  const island = ({ key, name, at: [cx, cy], soon }) => {
    const [sx, sy] = P(cx, cy);
    const plate = prism({
      outline: rrect({ x: cx - HALF, y: cy - HALF, w: HALF * 2, d: HALF * 2, r: 18 }),
      h: PLATE,
      tone: 'plate',
    });
    const object = OBJECTS[key]({ x: cx, y: cy - 10, z: PLATE });
    const text = `<text class="lbl">${name}</text>`;
    const label =
      cx > cy
        ? groundFlip({ x: cx + HALF - 16, y: cy + HALF - 24, z: PLATE, inner: text })
        : ground({ x: cx - HALF + 16, y: cy + HALF - 16, z: PLATE, inner: text });
    const reach = HALF + 8;
    const corners = [
      P(cx - reach, cy + reach),
      P(cx - reach, cy - reach),
      P(cx + reach, cy - reach),
      P(cx + reach, cy + reach),
    ];
    const hit = [
      corners[0],
      [corners[0][0], corners[0][1] - 60],
      [corners[1][0], corners[1][1] - 60],
      [corners[2][0], corners[2][1] - 60],
      corners[2],
      corners[3],
    ];
    const [px, py] = P(cx + HALF, cy - HALF, PLATE);
    const pill = soon
      ? `<g class="pill" transform="translate(${f(px - 6)} ${f(py - 22)})"><rect x="-22" y="-9" width="44" height="18" rx="9"/><text text-anchor="middle" y="3.2">SOON</text></g>`
      : '';
    return `<g class="isl${soon ? ' soon' : ''}${key === active ? ' on' : ''}" data-key="${key}"><ellipse fill="url(#iso-shade)" cx="${f(sx)}" cy="${f(sy + 16)}" rx="150" ry="84"/><g class="isl-lift">${plate}<g class="obj">${object}</g>${label}</g>${pill}${poly(hit, 'hit')}</g>`;
  };

  const LOGO =
    'M236.0 248.9A22 22 0 0 1 268.5 229.5L501.5 355.4A22 22 0 0 0 522.5 355.4L755.5 229.5A22 22 0 0 1 788.0 248.9L788.0 790.0A22 22 0 0 1 766.0 812.0L674.0 812.0A22 22 0 0 1 652.0 790.0L652.0 440.0L514.9 514.1A6 6 0 0 1 509.1 514.1L247.5 372.8A22 22 0 0 1 236.0 353.4ZM236.0 473.9A22 22 0 0 1 268.5 454.5L360.5 504.2A22 22 0 0 1 372.0 523.6L372.0 790.0A22 22 0 0 1 350.0 812.0L258.0 812.0A22 22 0 0 1 236.0 790.0ZM444.0 559.4A6 6 0 0 1 452.9 554.1L512.0 586.1L571.1 554.1A6 6 0 0 1 580.0 559.4L580.0 790.0A22 22 0 0 1 558.0 812.0L466.0 812.0A22 22 0 0 1 444.0 790.0Z';

  const board = () => {
    const ys = sparkYs({ worth: WORTH });
    const line = sparkLine({ ys });
    const module = (x, y) => prism({ outline: rrect({ x, y, w: 132, d: 132, r: 14 }), z: BASE, h: 8, tone: 'mod' });
    return (
      '<ellipse fill="url(#iso-glow)" cx="0" cy="34" rx="430" ry="230"/><ellipse fill="url(#iso-shade)" cx="0" cy="26" rx="320" ry="180"/>' +
      prism({ outline: rrect({ x: -150, y: -150, w: 300, d: 300, r: 26 }), h: BASE, tone: 'board' }) +
      prism({ outline: rrect({ x: -112, y: -112, w: 80, d: 80, r: 20 }), z: BASE, h: 22, tone: 'logo' }) +
      ground({
        x: -112,
        y: -112,
        z: BASE + 22,
        inner: `<path class="mark" transform="scale(${80 / 1024})" d="${LOGO}"/>`,
      }) +
      module(6, -138) +
      groundFlip({
        x: 6,
        y: -6,
        z: TOP,
        inner:
          '<text class="cap" x="14" y="24">NET WORTH</text><text class="num" data-v="nw" x="13" y="50">$148,672</text>' +
          `<path class="area" data-v="area" d="${line}V118H14Z"/>` +
          `<path class="spark" data-v="spark" d="${line}"/><circle class="spark-end" data-v="end" cx="118" cy="${ys[5].toFixed(1)}" r="4"/>`,
      }) +
      module(-138, 6) +
      ground({
        x: -138,
        y: 6,
        z: TOP,
        inner:
          '<text class="cap" x="14" y="24">CASH FLOW</text><text class="num sm" data-v="cf" x="13" y="46">+$1,240</text>',
      }) +
      `<g data-v="bars">${bars([20, 13, 28, 17, 36])}</g>` +
      module(6, 6) +
      ground({
        x: 6,
        y: 6,
        z: TOP,
        inner:
          '<text class="cap" x="14" y="24">INSIGHTS</text>' +
          '<rect class="bar ac" data-v="ins" x="14" y="40" width="38" height="5" rx="2.5"/><rect class="bar" data-v="ins" x="14" y="52" width="27" height="5" rx="2.5"/><rect class="bar" data-v="ins" x="14" y="64" width="33" height="5" rx="2.5"/>',
      }) +
      prism({ outline: disc({ x: 94, y: 92, r: 31 }), z: TOP, h: 6 }) +
      ground({
        x: 94,
        y: 92,
        z: TOP + 6,
        inner:
          '<circle class="gauge" r="19"/><circle class="gauge ac" data-v="ring" r="19" stroke-dasharray="44 119.4" transform="rotate(-90)"/>',
      })
    );
  };

  const grid = ({ reach = 900, mask = 'iso-mask' } = {}) => {
    let d = '';
    for (let i = -reach; i <= reach; i += 60) d += `M${i} ${-reach}V${reach}M${-reach} ${i}H${reach}`;
    return `<g mask="url(#${mask})">${ground({ inner: `<path class="floor-grid" d="${d}"/>` })}</g>`;
  };

  const finale = () => {
    const SCENE = [
      { key: 'liabilities', at: [-530, 210] },
      { key: 'vehicles', at: [210, -530] },
      {
        key: 'accounts',
        at: [-204, 458],
        wire: [
          [-204, 392],
          [-204, 190],
        ],
      },
      {
        key: 'investments',
        at: [458, -204],
        wire: [
          [392, -204],
          [190, -204],
        ],
      },
    ];
    const prop = ({ key, at: [cx, cy] }) => {
      const [sx, sy] = P(cx, cy);
      return (
        `<ellipse fill="url(#fin-shade)" cx="${f(sx)}" cy="${f(sy + 16)}" rx="150" ry="84"/>` +
        prism({
          outline: rrect({ x: cx - HALF, y: cy - HALF, w: HALF * 2, d: HALF * 2, r: 18 }),
          h: PLATE,
          tone: 'plate',
        }) +
        OBJECTS[key]({ x: cx, y: cy - 10, z: PLATE })
      );
    };
    const wires = SCENE.filter((it) => it.wire)
      .map(({ wire: points }) => {
        const [sx, sy] = points[0];
        return `<path class="wire-line" d="${route(points)}"/><circle class="port" cx="${sx}" cy="${sy}" r="4"/>`;
      })
      .join('');
    return (
      '<svg viewBox="-800 -640 1600 1280" focusable="false"><defs>' +
      '<radialGradient id="fin-fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="800" gradientTransform="scale(1 0.6)"><stop offset="0.46" stop-color="#fff" stop-opacity="0"/><stop offset="0.86" stop-color="#fff"/></radialGradient>' +
      '<mask id="fin-mask" maskUnits="userSpaceOnUse" x="-800" y="-640" width="1600" height="1280"><rect x="-800" y="-640" width="1600" height="1280" fill="url(#fin-fade)"/></mask>' +
      '<radialGradient id="fin-shade"><stop offset="0.35" class="shade-a"/><stop offset="1" class="shade-b"/></radialGradient>' +
      '</defs>' +
      grid({ reach: 1140, mask: 'fin-mask' }) +
      `<g mask="url(#fin-mask)">${ground({ inner: wires })}</g>` +
      SCENE.map(prop).join('') +
      '</svg>'
    );
  };

  const svg =
    '<svg class="iso-svg" viewBox="-600 -360 1200 765" aria-hidden="true" focusable="false">' +
    '<defs>' +
    '<radialGradient id="iso-fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="640" gradientTransform="scale(1 0.62)"><stop offset="0.3" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
    '<mask id="iso-mask" maskUnits="userSpaceOnUse" x="-600" y="-360" width="1200" height="765"><rect x="-600" y="-360" width="1200" height="765" fill="url(#iso-fade)"/></mask>' +
    '<radialGradient id="iso-glow"><stop offset="0" class="glow-a"/><stop offset="1" class="glow-b"/></radialGradient>' +
    '<radialGradient id="iso-shade"><stop offset="0.35" class="shade-a"/><stop offset="1" class="shade-b"/></radialGradient>' +
    '<linearGradient id="iso-logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="0.5" stop-color="#a855f7"/><stop offset="1" stop-color="#9333ea"/></linearGradient>' +
    '</defs>' +
    grid() +
    ISLANDS.map(wire).join('') +
    ISLANDS.filter((it) => !it.soon)
      .map(island)
      .join('') +
    `<g class="core">${board()}</g>` +
    ISLANDS.filter((it) => it.soon)
      .map(island)
      .join('') +
    '</svg>';

  return { svg, finale: finale() };
};
