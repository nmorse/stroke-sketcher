// === Geometry helpers ===
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy };
const lerp = (a, b, t) => a + (b - a) * t;

function pointLineDistance(p, a, b) {
    // distance from point p to segment ab
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.sqrt(dist2(p, a));
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.sqrt(dist2(p, b));
    const t = c1 / c2;
    const proj = { x: a.x + t * vx, y: a.y + t * vy };
    return Math.sqrt(dist2(p, proj));
}
// === App State ===
let img = new Image();
let imgLoaded = false;
let imgFileName = "none loaded";
let imgScale = 1;
let paintColor = "#ff7300"
const fileInput = document.getElementById('fileInput');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
// const marksDiv = document.getElementById('marks');

const HAL = [ // v (vertical) note a negative value indicates the paper is not at 0, but instead at -v 
    {w: 335, h: 295, v:100, zsafe: 60, palette_bottom: 50, hasAAxis: true, name: "ncnc Brush",
        brush: [
            {zrange: 7, shape: "round", width: 6}, 
            {zrange: 5, shape: "flat", width: 12}
        ]

    },
    {w: 150, h: 100, v:-16, zsafe: 0, palette_bottom: 12, hasAAxis: false, name: "Axidraw Mini-Kit 2",
        brush: [
            {zrange: 2, yoffset: -1.2, shape: "pen", width: 1}, 
            {zrange: 5, shape: "round", width: 5}
        ]
    },
];
let hali = 0; // hardware abstraction layer index number
let brushi = 0; // brush index number
const MM_W = () => HAL[hali].w; // machine work area (mm) 
const MM_H = () => HAL[hali].h;
const MM_V = () => HAL[hali].v; // if negative, inverted (positive down)
const PAL_MM_W = 10;
const PAL_Y_MIN = 20, PAL_Y_MAX = 30; // palette Y axis bounds
const mmPerPxX = () =>  MM_W() / canvas.width;  // 140 / 840 = 0.1667 mm/px
const mmPerPxY = () =>  MM_H() / canvas.height; // 100 / 600 = 0.1667 mm/px
const zbottom = () => HAL[hali].v<0? -HAL[hali].v-2: 2;
const ztop = () =>    HAL[hali].v<0? zbottom()-HAL[hali].brush[brushi].zrange: zbottom()+HAL[hali].brush[brushi].zrange;
const zclear = () =>  HAL[hali].v<0? ztop()-3: ztop()+3;
const zsafe = () =>   HAL[hali].v<0? Math.min(HAL[hali].zsafe, zclear()): Math.max(HAL[hali].zsafe, zclear());
const descent = 0.1; // percent of t
const ascent = 0.9;  // percent
const palette_bottom = () => HAL[hali].palette_bottom; // z axis brush dip depth
let tool = 'draw'; // 'draw' | 'select'
let strokes = [];   // {id, width, points:[{x,y}], selected:false}
let selectedId = null;

let drawing = false;
let lastPt = null;
let pointStep = 1.5; // pixels between captured points
// === UI wiring ===
const el = id => document.getElementById(id);
const whiteBalance = el('whiteBalance');
const toolDraw = el('toolDraw');
const toolSelect = el('toolSelect');
const widthInput = el('width');
const widthOut = el('widthOut');
const colorPicker = el('colorPicker');
const hueTolInput = el('hueTol');
const satTolInput = el('satTol');
const valTolInput = el('valTol');
const hueFacInput = el('hueFac');
const satFacInput = el('satFac');
const valFacInput = el('valFac');
const feedInput = el('feed');
const exportBtn = el('export');
const undoBtn = el('undo');
const clearBtn = el('clear');
const pointStepInput = el('pointStep');
const pointStepOut = el('pointStepOut');
const HALNumberInput = el('HALNumber');
const brushNumberInput = el('brushNumber');

const originalCanvas = document.createElement("canvas");
const originalCtx = originalCanvas.getContext("2d", {
  willReadFrequently: true
});

function setImgParams() {
    const imgAspect = img.width / img.height
    const canvasAspect = canvas.width / canvas.height
    const difAspect = imgAspect - canvasAspect
    imgScale = (difAspect <= 0)? canvas.height / img.height:  canvas.width / img.width
    // console.log(imgAspect, canvasAspect, difAspect, imgScale)
    originalCanvas.width = canvas.width; //image.naturalWidth;
    originalCanvas.height = canvas.height; //image.naturalHeight;
    originalCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, img.width*imgScale, img.height*imgScale);

}

fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const url = e.target.result;
        // console.log(file.name)
        imgFileName = file.name;
        const newImg = new Image();
        newImg.onload = () => {
            img = newImg;
            imgLoaded = true;
            setImgParams()
            drawAll();
        };
        newImg.src = url;
    };
    reader.readAsDataURL(file);
});

function setTool(next) {
    tool = next;
    whiteBalance.setAttribute('aria-pressed', tool === 'whiteBalance');
    toolDraw.setAttribute('aria-pressed', tool === 'draw');
    toolSelect.setAttribute('aria-pressed', tool === 'select');
    canvas.style.cursor = tool === 'draw' ? 'crosshair' : 'pointer';
}

window.onscroll = function() {
  scrollFunction();
};

function scrollFunction() {
  const header = document.getElementById("header");
  // console.log(document.body.scrollTop, document.documentElement.scrollTop)
  if (document.body.scrollTop > 0 || document.documentElement.scrollTop > 0) {
    // header.style.padding = "20px 10px"; // Reduced padding
    // header.style.fontSize = "4px"; // Reduced font size
    header.style.display = "none"; // hide

  } else {
    // header.style.padding = "50px 10px"; // Original padding
    // header.style.fontSize = "120px"; // Original font size
    header.style.display = "block"; // show
  }
}


whiteBalance.onclick = (e) => { 
    setTool('whiteBalance')
};
toolDraw.onclick = (e) => { 
    setTool('draw')
};
toolSelect.onclick = () => setTool('select');

widthInput.addEventListener('input', () => {
    widthOut.textContent = widthInput.value + ' px';
});
let hueTol = 0.05
hueTolInput.addEventListener('input', () => {
    hueTol = hueTolInput.value;
    drawAll()
});
let satTol = 0.5
satTolInput.addEventListener('input', () => {
    satTol = satTolInput.value;
    drawAll()
});
let valTol = 0.5
valTolInput.addEventListener('input', () => {
    valTol = valTolInput.value;
    drawAll()
});
let hueFac = 0.05
hueFacInput.addEventListener('input', () => {
    hueFac = hueFacInput.value;
    drawAll()
});
let satFac = 0.5
satFacInput.addEventListener('input', () => {
    satFac = satFacInput.value;
    drawAll()
});
let valFac = 0.5
valFacInput.addEventListener('input', () => {
    valFac = valFacInput.value;
    drawAll()
});

pointStepInput.addEventListener('input', () => {
    pointStep = parseFloat(pointStepInput.value);
    pointStepOut.textContent = pointStep + ' px';
});
HALNumberInput.addEventListener('input', () => {
    hali = parseInt(HALNumberInput.value) - 1;
    if (hali < 0 || hali >= HAL.length)
        hali = 0;
    setCanvasToHAL()
});
brushNumberInput.addEventListener('input', () => {
    brushi = parseInt(brushNumberInput.value) - 1;
    if (brushi < 0 || brushi >= HAL[hali].brush.length)
        brushi = 0;
    setCanvasToBrush()
});

function setCanvasToHAL() {
    const w = Math.abs(HAL[hali].w*2)
    canvas.width = w
    canvas.style.width = `${w}px`
    //console.log(w)
    const h = Math.abs(HAL[hali].h*2)
    canvas.height = h
    canvas.style.height = `${h}px`
    //console.log(h)
}
function setCanvasToBrush() {
    console.log("canvas action on brush change TBD")
}

undoBtn.onclick = () => { if (strokes.length) { strokes.pop(); selectedId = null; drawAll(); refreshList(); } };
clearBtn.onclick = () => { if (confirm('Clear all marks?')) { strokes = []; selectedId = null; drawAll(); refreshList(); } };
colorPicker.addEventListener("change", watchColorPicker);

function watchColorPicker(event) {
  paintColor = event.target.value;
  drawAll()
}
exportBtn.onclick = () => {
    const g = generateGCode(strokes, parseFloat(feedInput.value) || 800);
    downloadText(g, 'canvas_export.gcode');
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') { setTool('draw'); }
    else if (e.key === 's' || e.key === 'S') { setTool('select'); }
    else if (e.key === 'Delete') { deleteSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoBtn.click(); }
});

// === Drawing ===
canvas.addEventListener('pointerdown', (e) => {
    // const events = event.getCoalescedEvents();

    // for (const e of events) {
        const pos = getPos(e);
        if (tool === 'draw') {
            drawing = true; canvas.setPointerCapture(e.pointerId);
            const stroke = { id: crypto.randomUUID(), color: paintColor, width: parseFloat(widthInput.value) | 0 || 3, points: [pos], selected: false };
            strokes.push(stroke);
            lastPt = pos; 
            drawAll(stroke); refreshList();
        } 
        else if (tool === "whiteBalance") {
            //const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const imageData = originalCtx.getImageData(
                0, 0,
                originalCanvas.width,
                originalCanvas.height
            );

            const pixels = imageData.data;
            const rp = red(paintColor)
            const gp = green(paintColor)
            const bp = blue(paintColor)
            const [cp, mp, yp] = toSubtractive(rp, gp, bp)
            const [hp, sp, vp] = rgbToHsv(rp, gp, bp)
            // console.log("pos", pos)
            const i = (Math.floor(pos.x) + Math.floor(pos.y)*imageData.width) * 4
            const r = pixels[i]/255
            const g = pixels[i+1]/255
            const b = pixels[i+2]/255
            const [c, m, y] = toSubtractive(r, g, b)
            const [h, s, v] = rgbToHsv(r, g, b)
            const paint_c = cp*c
            const paint_m = mp*m
            const paint_y = yp*y
            const delta_h = ((degreeDiff(hp, h))/180)
            const delta_s = 1-Math.abs(sp - s)
            const delta_v = 1-Math.abs(vp - v)
            console.log(oklab_to_okLCh(linear_srgb_to_oklab([r, g, b])))

            console.log(r.toFixed(3), g.toFixed(3), b.toFixed(3), '--', imageData.width, canvas.width)
            console.log(degreeDiff(hp, h).toFixed(3), delta_h.toFixed(3), delta_s.toFixed(3), delta_v.toFixed(3))


        } 
        else {
            // select nearest stroke to click
            selectNearest(pos);
        }
    // }
});

canvas.addEventListener('pointermove', (event) => {
    const events = event.getCoalescedEvents();

    for (const e of events) {
        const pos = getPos(e);
        if (tool === 'draw' && drawing) {
            if (!lastPt || Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y) >= pointStep) {
                strokes[strokes.length - 1].points.push(pos);
                lastPt = pos;
                drawAll(strokes[strokes.length - 1]);
            }
        } else if (tool === 'select') {
            // hover effect (optional)
            drawAll(null, pos);
        }
    }
});

canvas.addEventListener('pointerup', (e) => { drawing = false; lastPt = null; try { canvas.releasePointerCapture(e.pointerId) } catch { } });
canvas.addEventListener('pointerleave', () => { drawing = false; lastPt = null; });

function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const press = e.pressure ?? 0.5
    return { x: (e.clientX - r.left) * (canvas.width / r.width), 
             y: (e.clientY - r.top) * (canvas.height / r.height),
             press,
             tiltX: e.tiltX,
             tiltY: e.tiltY,
             timeStamp: e.timeStamp
            };
}

function paint(s, c = "#ffffff") {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = s.width;
    ctx.strokeStyle = s.id === selectedId ? '#8ef' : s.color;
    ctx.globalAlpha = s.id === selectedId ? 1 : 0.8;
    ctx.beginPath();
    const pts = s.points;
    if (!pts.length) return;
    const pointerHasPressure = (pts[0].press !== 0.5)
    // ctx.moveTo(pts[0].x, pts[0].y);
    let lastX = pts[0].x
    let lastY = pts[0].y
    for (let i = 1; i < pts.length; i++) {
        const t = i/pts.length
        ctx.lineWidth = pointerHasPressure ? s.width * 2 * pts[i].press: zProfile(t, 0, s.width)
        // console.log(t, ctx.lineWidth)
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pts[i].x, pts[i].y);
        // ctx.arc(pts[i].x, pts[i].y, s.width*pts[i].press, 0, Math.PI * 2, false);
        // ctx.fillStyle = "green";
        // ctx.fill();
        ctx.closePath();
        lastX = pts[i].x
        lastY = pts[i].y 
        ctx.stroke();
        // ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
}

function drawAll(stroke=null, hoverPos = null) {
    
    // draw a faint mm grid every 10 mm
    // drawGrid();
    
    if (stroke) {
        paint(stroke, paintColor)
    }
    else { // display image, filtered by color then draw all strokes
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ff00ff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if(imgLoaded) {
            //ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, img.width*imgScale, img.height*imgScale);
            //const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // Fetch a fresh pixel buffer.
            const imageData = originalCtx.getImageData(
                0, 0,
                originalCanvas.width,
                originalCanvas.height
            );
            console.log('length', imageData.data.length)
            const pixels = imageData.data;
            const rp = red(paintColor)
            const gp = green(paintColor)
            const bp = blue(paintColor);
            const [vp, sp, hp] = oklab_to_okLCh(linear_srgb_to_oklab([rp, gp, bp]))

            // console.log('hsv picked', hp.toFixed(2), sp.toFixed(2), vp.toFixed(2))
            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i]/255
                const g = pixels[i+1]/255
                const b = pixels[i+2]/255

                // const [h, s, v] = rgbToHsv(r, g, b)
                const [v, s, h] = oklab_to_okLCh(linear_srgb_to_oklab([r, g, b]))
                const delta_h = radianDiff(hp, h)/Math.PI // 0 - 1
                const delta_s = Math.abs(sp - s)
                const delta_v = Math.abs(vp - v)

                const val = delta_h < hueTol && s > satTol && v > valTol ? delta_h*(1-s)+(v*valFac): 1

                const [light_r, light_g, light_b] = hsvToRgb(h, s, v)
                pixels[i] =     bP(val*255); // Red
                pixels[i + 1] = bP(val*255); // Green
                pixels[i + 2] = bP(val*255); // Blue
                // pixels[i + 3] is alpha; leave it unchanged
            }

            ctx.putImageData(imageData, 0, 0);
        }
        for (const s of strokes) {
            paint(s)
        }
    }

    if (tool === 'select' && hoverPos) {
        // show nearest stroke under cursor
        const { id } = nearestStroke(hoverPos);
        if (id) {
            const s = strokes.find(x => x.id === id);
            if (s) {
                ctx.lineWidth = s.width + 6;
                ctx.strokeStyle = 'rgba(110,231,255,0.25)';
                ctx.beginPath();
                const pts = s.points; ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.stroke();
            }
        }
    }
    // border
    ctx.strokeStyle = '#1e2a55'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, canvas.width, canvas.height);
}
function toSubtractive(r, g, b) {
    let c = 1 - r
    let m = 1 - g
    let y = 1 - b
    // const k = Math.min(c, m, y)
    // c = (c-k)/(1-k)
    // m = (m-k)/(1-k)
    // y = (y-k)/(1-k)
    return [c, m, y]
}

function rgbToHsv(r, g, b) {
//   r /= 255;
//   g /= 255;
//   b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return [h, s, v];
}
// console.log(rgbToHsv(1, 1, 0), 'yellow');
// console.log(rgbToHsv(0, 1, 1), 'cyan');
// console.log(rgbToHsv(1, 0, 1), 'magenta');
// console.log(rgbToHsv(0, 0, 0), 'black');
// console.log(rgbToHsv(1, 1, 1), 'white');
// console.log(rgbToHsv(.2, .4, .2), 'greenish');

function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1; // Hue wraps around; all inputs are 0–1

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

// Example: red, yellow...
// console.log(hsvToRgb(0, 1, 1), '[1, 0, 0]'); // [1, 1, 0]
// console.log(hsvToRgb(1 / 6, 1, 1), '[1, 1, 0]'); // [1, 1, 0]
// console.log(hsvToRgb(2 / 6, 1, 1), '[0, 1, 0]');
// console.log(hsvToRgb(3 / 6, 1, 1), '[0, 1, 1]');
// console.log(hsvToRgb(4 / 6, 1, 1), '[0, 0, 1]');
// console.log(hsvToRgb(5 / 6, 1, 1), '[1, 0, 1]');
// console.log(hsvToRgb(1, 1, 1), '[1, 0, 0]');

function degreeDiff(a, b) {
  return Math.abs(((b - a + 540) % 360) - 180);
}
// console.log(degreeDiff(350, 10), 20)
// console.log(degreeDiff(10, 350), 20)
// console.log(degreeDiff(0, 185), 175)
// console.log(degreeDiff(350, 370), 20)

function radianDiff(a, b) {
  return Math.abs(((b - a + Math.PI*3) % (Math.PI*2)) - Math.PI);
}
// console.log(radianDiff(Math.PI/4, Math.PI/2), Math.PI/4)
// console.log(radianDiff(-Math.PI/4, Math.PI/4), Math.PI/2)
// console.log(radianDiff(0, Math.PI-Math.PI/4), Math.PI/4*3)
// console.log(radianDiff(Math.PI*2-Math.PI/4, Math.PI*2+Math.PI/4), Math.PI-Math.PI/2)

function red(color) {
  const hex = color.startsWith("#") ? color.slice(1) : color;

  // Support #RGB and #RRGGBB
  const redHex = hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2);
  const red = Number.parseInt(redHex, 16);

  if (!/^[0-9a-fA-F]{1,2}$/.test(redHex) || Number.isNaN(red)) {
    throw new Error("Expected a CSS hex color such as #ffff00");
  }

  return red / 255;
}
// console.log('red', red('#80ff00'))
// console.log('red', red('#f8f'))
// console.log('red', red('#000080'))

function green(color) {
  const hex = color.startsWith("#") ? color.slice(1) : color;

  // Support #RGB and #RRGGBB
  const cHex = hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4);
  const c = Number.parseInt(cHex, 16);

  if (!/^[0-9a-fA-F]{1,2}$/.test(cHex) || Number.isNaN(c)) {
    console.log("bad value", cHex, c)
    //throw new Error("Expected a CSS hex color such as #ffff00");
  }

  return c / 255;
}
// console.log('green', green('#80ff00'))
// console.log('green', green('#f8f'))
// console.log('green', green('#000080'))
function blue(color) {
  const hex = color.startsWith("#") ? color.slice(1) : color;

  // Support #RGB and #RRGGBB
  const cHex = hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6);
  const c = Number.parseInt(cHex, 16);

  if (!/^[0-9a-fA-F]{1,2}$/.test(cHex) || Number.isNaN(c)) {
    throw new Error("Expected a CSS hex color such as #ffff00");
  }

  return c / 255;
}
// console.log('blue', blue('#80ff00'))
// console.log('blue', blue('#f8f'))
// console.log('blue', blue('#000080'))

// bounded pixel to 0 - 255 
function bP(pv) {
    return Math.max(0, Math.min(255, pv))
}

function drawGrid() {
    const mmPerGrid = 10; // 10mm grid
    const pxX = mmPerGrid / mmPerPxX();
    const pxY = mmPerGrid / mmPerPxY();
    ctx.save();
    ctx.strokeStyle = 'rgba(168,179,209,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = pxX; x < canvas.width; x += pxX) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
    for (let y = pxY; y < canvas.height; y += pxY) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
    ctx.stroke();
    ctx.restore();
}

function selectNearest(pos) {
    const { id } = nearestStroke(pos);
    selectedId = id || null;
    drawAll(); refreshList();
}

// selection of a stroke
function nearestStroke(pos) {
    let bestId = null, bestD = Infinity;
    for (const s of strokes) {
        const pts = s.points; if (pts.length < 2) continue;
        for (let i = 1; i < pts.length; i++) {
            const d = pointLineDistance(pos, pts[i - 1], pts[i]);
            if (d < bestD) { bestD = d; bestId = s.id; }
        }
    }
    const tolerance = 10; // px
    if (bestD > tolerance) return { id: null, d: bestD };
    return { id: bestId, d: bestD };
}

function deleteSelected() {
    if (!selectedId) return;
    const idx = strokes.findIndex(s => s.id === selectedId);
    if (idx >= 0) { strokes.splice(idx, 1); selectedId = null; drawAll(); refreshList(); }
}

function refreshList() {
    // marksDiv.innerHTML = '';
    strokes.forEach((s, i) => {
        const d = document.createElement('div');
        d.textContent = `Mark ${i + 1}  (${s.points.length} pts, width ${s.width}px)`;
        d.className = (s.id === selectedId) ? 'active' : '';
        d.onclick = () => { selectedId = s.id; drawAll(s); refreshList(); };
        d.ondblclick = () => { if (confirm('Delete this mark?')) { selectedId = s.id; deleteSelected(); } };
        // marksDiv.appendChild(d);
    });
}

function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// === G‑Code generation with bounds clipping
function pxToMm(pt) {
    const x = pt.x * mmPerPxX()
    const y = pt.y * mmPerPxY()
    return { x, y };
}

function inBounds(pt3) {
    const x = Math.max(0, Math.min(MM_W(), pt3[0]))
    const y = Math.max(0, Math.min(MM_H(), pt3[1]))
    const z = Math.max(0, Math.min(MM_V(), pt3[2]))
    return [ x, y, z ]
}

function zPressure(pressure) {
    return lerp(ztop(), zbottom(), pressure)
}

function zProfile(t, top, bot) {
    // t in [0,1]: 0-0.25: 0->4; 0.25-0.75: hold 4; 0.75-1: 4->0
    // console.log(t, t / descent, (1 - t) / (1 - ascent))
    if (t <= descent) return lerp(top, bot, t / descent); // top..bottom
    if (t >= ascent) return lerp(top, bot, (1 - t) / (1 - ascent)); // bottom..top
    return bot;
}

function generateGCode(strokes, feed) {
    const lines = [];
    lines.push('; Canvas → G‑Code export');
    lines.push(`; Work area: X 0..${HAL[hali].w}mm, Y 0..${HAL[hali].h}mm, Z 0..${HAL[hali].v}mm (safe)`);
    lines.push('G21 ; set units to millimeters');
    lines.push('G90 ; absolute positioning');
    lines.push(`G0 Z${zsafe().toFixed(2)}`);
    lines.push('G0 X0 Y0');

    const hasAAxis = HAL[hali].hasAAxis
    if (hasAAxis) {
        lines.push('G0 A0');
    }

    initBrushMachineRotation()
    lastColor = null
    let i = -1
    strokes.forEach((s) => {
        if (!s.points || s.points.length < 5) return;
        const pts = smooth2D(smooth2D(smooth2D(s.points.map(pxToMm))));
        const { L, total } = cumulativeLengths(pts);
        if (total <= 0) return;

        const start = pts[0];
        i += 1

        if (HAL[hali].brush[brushi].shape !== 'pen' && (i % 3 === 0 || lastColor !== s.color)) {
            lines.push(`\n; ---- Dip ${i + 1} in color ${s.color} ----`);
            if (lastColor !== s.color) {
                lines.push('M00')
            }
            lines.push(`G0 Z${zsafe().toFixed(2)}`);
            const palY = lerp(PAL_Y_MIN, PAL_Y_MAX, 0.5) // Math.random())
            lines.push(`G0 X0 Y${palY.toFixed(2)}`);
            lines.push(`G1 X${(PAL_MM_W).toFixed(2)} Z${palette_bottom().toFixed(2)} F${feed.toFixed(0)}`);
            lines.push(`G1 Z${zsafe().toFixed(2)} F${feed}`);
            lines.push(`G1 X${(PAL_MM_W+4).toFixed(2)} F${feed}`);            
            lines.push(`G1 Z${zclear().toFixed(2)} F${feed}`);
        }
        lastColor = s.color
        lines.push(`\n; ---- Mark ${i + 1} ----`);
        lines.push(`G0 Z${zclear().toFixed(2)}`);
        if (hasAAxis) {
            const r = angle(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
            const [x, y, z] = inBounds(offsetPt(start.x, start.y, zclear(), r))
            const a = brushMachineRotation(r)
            lines.push(`G0 X${x.toFixed(2)} Y${y.toFixed(2)} Z${(z+5).toFixed(2)} A${a.toFixed(1)}`);
        }
        else {
            lines.push(`G0 X${start.x.toFixed(2)} Y${start.y.toFixed(2)} Z${zclear().toFixed(2)}`);
        }
        const pointerHasPressure = (s.points[0].press !== 0.5)

        let prevAngle = brushMachineRotation(angle(pts[1].x - pts[0].x, pts[1].y - pts[0].y))
        for (let i = 1; i < pts.length; i++) {

            const t = L[i] / total; // 0..1 progress along this mark
            const pz = pointerHasPressure? zPressure(s.points[i].press) : zProfile(t, ztop(), zbottom());
            // console.log(t, pz)
            const p = pts[i];
            if (hasAAxis) {
                let r = angle(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y)
                const [x, y, z] = inBounds(offsetPt(p.x, p.y, pz, r))
                const a = brushMachineRotation(r)
                const f = rotAdjustedFeedRate(prevAngle - a, feed)
                prevAngle = a
                lines.push(`G1 X${x.toFixed(2)} Y${y.toFixed(2)} Z${z.toFixed(2)} A${a.toFixed(1)} F${f.toFixed(0)} `);
            }
            else {
                lines.push(`G1 X${p.x.toFixed(2)} Y${p.y.toFixed(2)} Z${pz.toFixed(2)} F${feed.toFixed(0)}`);
            }
        }
        // ensure end at Z is pen up 
        const [endx, endy, _endz] = inBounds([pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z]);
        lines.push(`G1 X${endx.toFixed(2)} Y${endy.toFixed(2)} Z${zclear().toFixed(2)} F${feed.toFixed(0)}`);
        // lines.push(`G0 Z${zclear().toFixed(3)}`);
    });
    lines.push(`\nG0 Z${zsafe().toFixed(2)}`);
    if (hasAAxis) {
        lines.push('G0 A0');
    }
    lines.push('G0 X0 Y0');
    lines.push('M2 ; program end');
    lines.push(`; HAL:${JSON.stringify(HAL[hali])}`);
    lines.push(`; target:${imgFileName}`);
    const printStokes = strokes.map((s)=>{return{"width":s.width,"color":s.color,"points":s.points.map(p=>{return[precision(p.x, 2), precision(p.y, 2), p.press]})}})
    lines.push(`; {strokes:[`);
    for (const ps of printStokes) {
        lines.push(`;  ${JSON.stringify(ps, null, '')},`);
    }
    lines.push(`; ]}`);

    return lines.join('\n');
}
function precision(v, p) {
    const i = Math.round(v*p*10)
    return i/(p*10)
}

// initial paint
colorPicker.value = paintColor;
drawAll();
refreshList();
setCanvasToHAL();


// machine angle
function angle(dx, dy) {
	return Math.atan2(dy, dx)
}
// // test angle function
// console.log(angle(1, 0).toFixed(2), 0)
// console.log(angle(1, 1).toFixed(2), 45)
// console.log(angle(0, 1).toFixed(2), 90)
// console.log(angle(-1, 1).toFixed(2), 135)
// console.log(angle(-1, 0).toFixed(2), 180)
// console.log(angle(-1, -1).toFixed(2), 225)
// console.log(angle(0, -1).toFixed(2), 270)
// console.log(angle(1, -1).toFixed(2), 315)

// [x, y, z, f] = offsetPt(p.x, p.y, pz, r)
function offsetPt(ox, oy, oz, brushRotation) {
    brushAngle = 0.79 // 0.79 radians (45 degrees)
    brushLengthMm = 30
	bx = Math.cos(brushRotation) * Math.sin(brushAngle) * brushLengthMm;
	by = Math.sin(brushRotation) * Math.sin(brushAngle) * brushLengthMm;
	bz = Math.cos(brushAngle) * brushLengthMm;
    return [ox+bx, oy+by, oz+bz]
}

function setMachineBrushOffset(brushOffset, brushRotation, brushAngle, brushLengthMm) {
	bx = Math.cos(brushRotation) * Math.sin(brushAngle) * brushLengthMm;
	by = Math.sin(brushRotation) * Math.sin(brushAngle) * brushLengthMm;
	bz = Math.cos(brushAngle) * brushLengthMm;
}

let last_br_deg = 0;
let offset_br_deg = 0;

function initBrushMachineRotation() {
	last_br_deg = 0;
	offset_br_deg = 0;
}
function brushMachineRotation(brushRotationRad) {
	
	let br_deg = brushRotationRad * 57.29578
	// console.log(br_deg.toFixed(2))
	// bp_deg will range from -180 to 180 degrees

	if (last_br_deg === null) {
		last_br_deg = br_deg
	}
	const dif = last_br_deg - br_deg
	if (Math.abs(dif) > 200) {
		if (dif > 0) {
			offset_br_deg += 360
		}
		else {
			offset_br_deg -= 360
		}
	}
	last_br_deg = br_deg
	return (br_deg + offset_br_deg)
}

function rotAdjustedFeedRate(da, of) {
    return of+Math.abs(da*23)
}

function smooth2D(points) {
    const shmoo = [points[0], average3Pts(points[0], points[1], points[2]), average3Pts(points[1], points[2], points[3])];
    for (let i = 3; i < points.length-3; i++) {
        shmoo.push(average7Pts(points[i-3], points[i-2], points[i-1], points[i], points[i+1], points[i+2], points[i+3]))
    }
    shmoo.push(points[points.length-3])
    shmoo.push(points[points.length-2])
    shmoo.push(points[points.length-1])
    return shmoo;
}

function average3Pts(a, b, c) {
    return {x: a.x*0.3+b.x*0.4+c.x*0.3, y:a.y*0.3+b.y*0.4+c.y*0.3}
}
function average5Pts(a, b, c, d, e) {
    // const af = 0.125, bf = 0.25, cf= 0.25, df = 0.25, ef = 0.125
    const af = 0.0625, bf = 0.25, cf= 0.375, df = 0.25, ef = 0.0625 // 5-Point Gaussian Weights
    return {x: a.x*af+b.x*bf+c.x*cf+d.x*df+e.x*ef, y: a.y*af+b.y*bf+c.y*cf+d.y*df+e.y*ef}
}
// a 7 point bell curve smoothing function
function average7Pts(a, b, c, d, e, f, g) {
    const af = 0.0625; 
    const bf = 0.125;
    const cf = 0.1875;
    const df = 0.25;
    const ef = 0.1875;
    const ff = 0.125;
    const gf = 0.0625;

    return {x: a.x*af+b.x*bf+c.x*cf+d.x*df+e.x*ef+f.x*ff+g.x*gf, 
            y: a.y*af+b.y*bf+c.y*cf+d.y*df+e.y*ef+f.y*ff+g.y*gf}
}

function cumulativeLengths(points) {
    const L = [0];
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        L[i] = L[i - 1] + Math.hypot(dx, dy);
    }
    return { L, total: L[L.length - 1] || 0 };
}

// console.log(oklab_to_okLCh(linear_srgb_to_oklab(r, g, b)))
// https://bottosson.github.io/posts/oklab/
// Copyright (c) 2020 Björn Ottosson
function oklab_to_okLCh ([L, a, b]) {
    const C = Math.hypot(a, b)
    const h = Math.atan2(b, a)
    return [L, C, h]
}
function okLCh_to_oklab ([L, C, h]) {
    const a = C*Math.cos(h)
    const b = C*Math.sin(h)
    return [L, a, b]
}
// Lab [L, a, b];
// RGB [r, g, b];
// RGB -> linear_srgb_to_oklab -> Lab
function linear_srgb_to_oklab([r, g, b]) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l); // cuberoot
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return [
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    ];
}

// Lab -> oklab_to_linear_srgb -> RGB
function oklab_to_linear_srgb([L, a, b]) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_*l_*l_; // cube
    const m = m_*m_*m_;
    const s = s_*s_*s_;

    return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
}