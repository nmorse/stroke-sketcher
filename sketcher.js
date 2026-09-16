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
let imgScale = 1;
const fileInput = document.getElementById('fileInput');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
// const marksDiv = document.getElementById('marks');

const HAL = [ // v (vertical) is defined from the paper so negative dimensions indicate the paper is in not at 0 
    {w: 150, h: -100, v:16, ztop: 3.4, hasAAxis: false },
    {w: 335, h: 295, v:-100, ztop: 80, hasAAxis: true }
];
let hali = 1; // hardware abstraction layer index number
const MM_W = () => HAL[hali].w; // machine work area (mm) 
const MM_H = () => HAL[hali].h;
const MM_V = () => HAL[hali].v;
const PAL_MM_W = 30;
const PAL_Y_MIN = 20, PAL_Y_MAX = 30; // palette Y axis bounds
const mmPerPxX = () => (MM_W() - PAL_MM_W) / canvas.width;  // 140 / 840 = 0.1667 mm/px
const mmPerPxY = () =>  MM_H() / canvas.height; // 100 / 600 = 0.1667 mm/px
const ztop = () => HAL[hali].ztop;
const descent = 0.03; // percent of t
const ascent = 0.97;  // percent
const bottom = 10;
const palette_bottom = 50;
let tool = 'draw'; // 'draw' | 'select'
let strokes = [];   // {id, width, points:[{x,y}], selected:false}
let selectedId = null;

let drawing = false;
let lastPt = null;
let pointStep = 1.5; // pixels between captured points
// === UI wiring ===
const el = id => document.getElementById(id);
const toolDraw = el('toolDraw');
const toolSelect = el('toolSelect');
const widthInput = el('width');
const widthOut = el('widthOut');
const feedInput = el('feed');
const exportBtn = el('export');
const undoBtn = el('undo');
const clearBtn = el('clear');
const pointStepInput = el('pointStep');
const pointStepOut = el('pointStepOut');
const HALNumberInput = el('HALNumber');

function setImgParams() {
    const imgAspect = img.width / img.height
    const canvasAspect = canvas.width / canvas.height
    const difAspect = imgAspect - canvasAspect
    imgScale = (difAspect <= 0)? canvas.height / img.height:  canvas.width / img.width
    // console.log(imgAspect, canvasAspect, difAspect, imgScale)
}

fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const url = e.target.result;
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
    toolDraw.setAttribute('aria-pressed', tool === 'draw');
    toolSelect.setAttribute('aria-pressed', tool === 'select');
    canvas.style.cursor = tool === 'draw' ? 'crosshair' : 'pointer';
}

toolDraw.onclick = () => setTool('draw');
toolSelect.onclick = () => setTool('select');

widthInput.addEventListener('input', () => {
    widthOut.textContent = widthInput.value + ' px';
});
pointStepInput.addEventListener('input', () => {
    pointStep = parseFloat(pointStepInput.value);
    pointStepOut.textContent = pointStep + ' px';
});
HALNumberInput.addEventListener('input', () => {
    hali = parseInt(HALNumberInput.value) - 1;
    if (hali < 0 || hali >= HAL.length)
        hali = 0;
    const w = Math.abs(HAL[hali].w*2)
    canvas.width = w
    canvas.style.width = `${w}px`
    //console.log(w)
    const h = Math.abs(HAL[hali].h*2)
    canvas.height = h
    canvas.style.height = `${h}px`
    //console.log(h)
});

undoBtn.onclick = () => { if (strokes.length) { strokes.pop(); selectedId = null; drawAll(); refreshList(); } };
clearBtn.onclick = () => { if (confirm('Clear all marks?')) { strokes = []; selectedId = null; drawAll(); refreshList(); } };

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
            const stroke = { id: crypto.randomUUID(), width: parseFloat(widthInput.value) | 0 || 3, points: [pos], selected: false };
            strokes.push(stroke);
            lastPt = pos; drawAll(); refreshList();
        } else {
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
                drawAll();
            }
        } else if (tool === 'select') {
            // hover effect (optional)
            drawAll(pos);
        }
    }
});

canvas.addEventListener('pointerup', (e) => { drawing = false; lastPt = null; try { canvas.releasePointerCapture(e.pointerId) } catch { } });
canvas.addEventListener('pointerleave', () => { drawing = false; lastPt = null; });

function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), 
             y: (e.clientY - r.top) * (canvas.height / r.height),
             press: e.pressure,
             tiltX: e.tiltX,
             tiltY: e.tiltY,
             timeStamp: e.timeStamp
            };
}

function drawAll(hoverPos = null) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, img.width*imgScale, img.height*imgScale);

    // draw a faint mm grid every 10 mm
    // drawGrid();

    for (const s of strokes) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = s.width;
        ctx.strokeStyle = s.id === selectedId ? '#8ef' : '#cfe4ff';
        ctx.globalAlpha = s.id === selectedId ? 1 : 0.9;
        ctx.beginPath();
        const pts = s.points;
        if (!pts.length) continue;
        // ctx.moveTo(pts[0].x, pts[0].y);
        let lastX = pts[0].x
        let lastY = pts[0].y 
        for (let i = 1; i < pts.length; i++) {
            ctx.lineWidth = s.width * 2 * pts[i].press
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(pts[i].x, pts[i].y);
            // ctx.arc(pts[i].x, pts[i].y, s.width*pts[i].press, 0, Math.PI * 2, false);
            ctx.fillStyle = "green";
            // ctx.fill();
            ctx.closePath();
            lastX = pts[i].x
            lastY = pts[i].y 
            ctx.stroke();
            // ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
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
        d.onclick = () => { selectedId = s.id; drawAll(); refreshList(); };
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
    const x = Math.max(PAL_MM_W, Math.min(MM_W() + PAL_MM_W, pt.x * mmPerPxX() + PAL_MM_W))
    const y = Math.max(0, Math.min(MM_H(), MM_H() - pt.y * mmPerPxY()))
    return { x, y };
}

function zProfile(t) {
    // t in [0,1]: 0-0.25: 0->4; 0.25-0.75: hold 4; 0.75-1: 4->0
    if (t <= descent) return lerp(ztop(), bottom, t / descent); // ztop..bottom
    if (t >= ascent) return lerp(ztop(), bottom, (1 - t) / (1 - ascent)); // bottom..ztop
    return bottom;
}

function generateGCode(strokes, feed) {
    const lines = [];
    lines.push('; Canvas → G‑Code export');
    lines.push(`; Work area: X 0..${HAL[hali].w}mm, Y 0..${HAL[hali].h}mm, Z 0..${HAL[hali].v}mm (safe)`);
    lines.push('G21 ; set units to millimeters');
    lines.push('G90 ; absolute positioning');
    lines.push(`G0 Z${ztop().toFixed(3)}`);
    lines.push('G0 X0 Y0');

    const hasAAxis = HAL[hali].hasAAxis
    if (hasAAxis) {
        lines.push('G0 A0');
    }

    strokes.forEach((s, idx) => {
        if (!s.points || s.points.length < 2) return;
        const pts = smooth2D(s.points.map(pxToMm));
        const { L, total } = cumulativeLengths(pts);
        if (total <= 0) return;

        const start = pts[0];
        lines.push(`\n; ---- Dip ${idx + 1} ----`);
        lines.push(`G0 Z${ztop().toFixed(3)}`);
        const palY = lerp(PAL_Y_MIN, PAL_Y_MAX, Math.random())
        lines.push(`G0 X${(PAL_MM_W - 10).toFixed(2)} Y${palY.toFixed(2)}`);
        lines.push(`G1 X${(PAL_MM_W - 14).toFixed(2)} Z${palette_bottom.toFixed(2)} F${feed.toFixed(0)}`);
        lines.push(`G1 X0 F${feed}`);
        lines.push(`G1 Z${ztop().toFixed(3)} F${feed.toFixed(0)}`);
        lines.push(`G0 X${(PAL_MM_W - 10).toFixed(2)} Y${palY.toFixed(2)}`);
        lines.push(`G1 X${(PAL_MM_W - 14).toFixed(2)} Z${palette_bottom.toFixed(2)} F${feed.toFixed(0)}`);
        lines.push(`G1 X0 Y${PAL_Y_MIN.toFixed(2)} F${feed.toFixed(0)}`);
        lines.push(`G1 Z${ztop().toFixed(3)} F${feed}`);
        lines.push(`G0 X${(PAL_MM_W - 10).toFixed(2)} Y${palY.toFixed(2)}`);
        lines.push(`G1 X${(PAL_MM_W - 14).toFixed(2)} Z${palette_bottom.toFixed(2)} F${feed.toFixed(0)}`);
        lines.push(`G1 X0 Y${PAL_Y_MAX.toFixed(2)} F${feed.toFixed(0)}`);
        lines.push(`G1 Z${ztop().toFixed(3)} F${feed}`);

        lines.push(`\n; ---- Mark ${idx + 1} ----`);
        lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`);
        lines.push(`G1 Z${ztop().toFixed(3)} F${feed.toFixed(0)}`);

        initBrushMachineRotation()

        let prevAngle = brushMachineRotation(angle(pts[1].x - pts[0].x, pts[1].y - pts[0].y))
        for (let i = 1; i < pts.length; i++) {

            const t = L[i] / total; // 0..1 progress along this mark
            const pz = zProfile(t);
            const p = pts[i];
            if (hasAAxis) {
                let r = angle(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y)
                const [x, y, z] = offsetPt(p.x, p.y, pz, r)
                const a = brushMachineRotation(r)
                const f = rotAdjustedFeedRate(prevAngle - a, feed)
                prevAngle = a
                lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(2)} Z${z.toFixed(2)} A${a.toFixed(1)} F${f.toFixed(0)} `);
            }
            else {
                lines.push(`G1 X${p.x.toFixed(2)} Y${p.y.toFixed(2)} Z${pz.toFixed(2)} F${feed.toFixed(0)}`);
            }
        }
        // ensure end at Z is pen up 
        const end = pts[pts.length - 1];
        lines.push(`G1 X${end.x.toFixed(3)} Y${end.y.toFixed(3)} Z${ztop().toFixed(3)} F${feed}`);
        // lines.push(`G0 Z${ztop().toFixed(3)}`);
    });
    lines.push(`\nG0 Z${ztop().toFixed(3)}`);
    if (hasAAxis) {
        lines.push('G0 A0');
    }
    lines.push('G0 X0 Y0');
    lines.push('M2 ; program end');
    return lines.join('\n');
}

// initial paint
drawAll();
refreshList();


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
    const shmoo = [points[0], average3Pts(points[0], points[1], points[2])];
    for (let i = 2; i < points.length-2; i++) {
        shmoo.push(average5Pts(points[i-2], points[i-1], points[i], points[i+1], points[i+2]))
    }
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

function cumulativeLengths(points) {
    const L = [0];
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        L[i] = L[i - 1] + Math.hypot(dx, dy);
    }
    return { L, total: L[L.length - 1] || 0 };
}

