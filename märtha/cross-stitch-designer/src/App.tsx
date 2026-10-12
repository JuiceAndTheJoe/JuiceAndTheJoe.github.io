import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent } from "react";
import {
  Download,
  Eraser,
  Grid3X3,
  ImageOff,
  ImagePlus,
  Maximize2,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { colorById, DMC_COLORS } from "./data/dmcColors";
import type { DMCColor } from "./data/dmcColors";
import "./App.css";

type Tool = "pencil" | "eraser" | "picker" | "fill";
type Pattern = { width: number; height: number; cells: (string | null)[][] };
// kept to plain ASCII/WinAnsi characters so jsPDF's standard fonts can render them in the exported PDF
const SYMBOLS = [
  "X",
  "O",
  "+",
  "#",
  "%",
  "@",
  "*",
  "=",
  "~",
  "^",
  "<",
  ">",
  "?",
  "!",
  "&",
  "$",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];
const makePattern = (width: number, height: number): Pattern => ({
  width,
  height,
  cells: Array.from({ length: height }, () =>
    Array<string | null>(width).fill(null),
  ),
});
const rgb = (color?: DMCColor) =>
  color ? `rgb(${color.rgb.join(",")})` : "#fff";
const colorDistance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const closestColor = (
  target: readonly [number, number, number],
  palette: DMCColor[],
) => {
  let nearest = palette[0];
  let distance = Infinity;
  palette.forEach((color) => {
    const value = colorDistance(target, color.rgb);
    if (value < distance) {
      distance = value;
      nearest = color;
    }
  });
  return nearest;
};
// buckets a color into a rainbow family by hue, treating low-saturation colors as neutrals
const COLOR_FAMILIES = [
  "neutral",
  "red",
  "pink",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
] as const;
type ColorFamily = (typeof COLOR_FAMILIES)[number];
const toHsl = ([r, g, b]: readonly [number, number, number]) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  h *= 60;
  return { h, s, l };
};
const colorFamily = (color: DMCColor): ColorFamily => {
  const { h, s } = toHsl(color.rgb);
  if (s < 0.15) return "neutral";
  if (h < 20 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
};
const smartSort = (colors: DMCColor[]) =>
  [...colors].sort((a, b) => {
    const familyDiff =
      COLOR_FAMILIES.indexOf(colorFamily(a)) -
      COLOR_FAMILIES.indexOf(colorFamily(b));
    if (familyDiff !== 0) return familyDiff;
    const ha = toHsl(a.rgb);
    const hb = toHsl(b.rgb);
    if (Math.abs(ha.h - hb.h) > 1) return ha.h - hb.h;
    return hb.l - ha.l;
  });
const numberSortValue = (number: string) => {
  const parsed = parseInt(number, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
};
const SMART_SORTED_COLORS = smartSort(DMC_COLORS);
const matchesSearch = (color: DMCColor, query: string) =>
  `${color.number} ${color.name}`.toLowerCase().includes(query.toLowerCase());

function App() {
  const [pattern, setPattern] = useState<Pattern>(() => makePattern(32, 24));
  const [patternName, setPatternName] = useState("Untitled sampler");
  const [history, setHistory] = useState<Pattern[]>([]);
  const [future, setFuture] = useState<Pattern[]>([]);
  const [selectedColor, setSelectedColor] = useState("310");
  const [tool, setTool] = useState<Tool>("pencil");
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [familyFilter, setFamilyFilter] = useState<ColorFamily | null>(null);
  const [paletteSort, setPaletteSort] = useState<"family" | "number" | "name">(
    "family",
  );
  const [importUrl, setImportUrl] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"stitch" | "background">(
    "stitch",
  );
  const [importSize, setImportSize] = useState({
    width: 32,
    height: 24,
    colors: 12,
  });
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ active: boolean; erase: boolean }>({
    active: false,
    erase: false,
  });

  const used = useMemo(() => {
    const counts = new Map<string, number>();
    pattern.cells
      .flat()
      .forEach((id) => id && counts.set(id, (counts.get(id) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [pattern]);
  const symbols = useMemo(
    () =>
      Object.fromEntries(
        used.map(([id], index) => [id, SYMBOLS[index % SYMBOLS.length]]),
      ),
    [used],
  );
  const sidebarColors = useMemo(
    () => SMART_SORTED_COLORS.filter((color) => matchesSearch(color, search)),
    [search],
  );
  const modalColors = useMemo(() => {
    const base =
      paletteSort === "number"
        ? [...DMC_COLORS].sort(
            (a, b) => numberSortValue(a.number) - numberSortValue(b.number),
          )
        : paletteSort === "name"
          ? [...DMC_COLORS].sort((a, b) => a.name.localeCompare(b.name))
          : SMART_SORTED_COLORS;
    return base.filter(
      (color) =>
        matchesSearch(color, search) &&
        (!familyFilter || colorFamily(color) === familyFilter),
    );
  }, [paletteSort, familyFilter, search]);
  const totalStitches = used.reduce((sum, [, count]) => sum + count, 0);

  const commit = (next: Pattern) => {
    setHistory((items) => [...items.slice(-30), pattern]);
    setFuture([]);
    setPattern(next);
  };
  const updateCell = (row: number, column: number, color: string | null) => {
    if (pattern.cells[row][column] === color) return;
    const cells = pattern.cells.map((current) => [...current]);
    cells[row][column] = color;
    commit({ ...pattern, cells });
  };
  const floodFill = (row: number, column: number) => {
    const original = pattern.cells[row][column];
    if (original === selectedColor) return;
    const cells = pattern.cells.map((current) => [...current]);
    const queue = [[row, column]];
    const seen = new Set<string>();
    while (queue.length) {
      const [r, c] = queue.shift()!;
      const key = `${r}:${c}`;
      if (
        seen.has(key) ||
        r < 0 ||
        c < 0 ||
        r >= pattern.height ||
        c >= pattern.width ||
        cells[r][c] !== original
      )
        continue;
      seen.add(key);
      cells[r][c] = selectedColor;
      queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
    }
    commit({ ...pattern, cells });
  };
  const paint = (row: number, column: number) => {
    if (tool === "picker") {
      const picked = pattern.cells[row][column];
      if (picked) {
        setSelectedColor(picked);
        setTool("pencil");
      }
      return;
    }
    if (tool === "fill") {
      floodFill(row, column);
      return;
    }
    updateCell(row, column, tool === "eraser" ? null : selectedColor);
  };
  const cellFromPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const column = Math.floor(
      ((clientX - rect.left) / rect.width) * pattern.width,
    );
    const row = Math.floor(
      ((clientY - rect.top) / rect.height) * pattern.height,
    );
    if (
      row < 0 ||
      column < 0 ||
      row >= pattern.height ||
      column >= pattern.width
    )
      return null;
    return { row, column };
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const cell = cellFromPoint(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const erase = event.button === 2;
    dragRef.current = { active: true, erase };
    if (erase) updateCell(cell.row, cell.column, null);
    else paint(cell.row, cell.column);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    const cell = cellFromPoint(event.clientX, event.clientY);
    if (!cell) return;
    if (dragRef.current.erase) updateCell(cell.row, cell.column, null);
    else paint(cell.row, cell.column);
  };
  const pointerUp = () => {
    dragRef.current = { active: false, erase: false };
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [pattern, ...items]);
    setPattern(previous);
    setHistory((items) => items.slice(0, -1));
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, pattern]);
    setPattern(next);
    setFuture((items) => items.slice(1));
  };
  const createPattern = (event: ChangeEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const width = Math.min(100, Math.max(1, Number(form.get("width"))));
    const height = Math.min(100, Math.max(1, Number(form.get("height"))));
    const name = String(form.get("name") || "").trim();
    setPattern(makePattern(width, height));
    setPatternName(name || "Untitled sampler");
    setHistory([]);
    setFuture([]);
    setShowNew(false);
  };
  const openImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImportUrl(url);
    setImportMode("stitch");
    setShowImport(true);
    const image = new Image();
    image.onload = () => {
      // prefill width/height to match the source image's aspect ratio so it isn't stretched
      const maxDim = 50;
      const ratio = image.naturalWidth / image.naturalHeight;
      const width = Math.min(
        100,
        Math.max(1, Math.round(ratio >= 1 ? maxDim : maxDim * ratio)),
      );
      const height = Math.min(
        100,
        Math.max(1, Math.round(ratio >= 1 ? maxDim / ratio : maxDim)),
      );
      setImportSize((current) => ({ ...current, width, height }));
    };
    image.src = url;
  };
  const convertImage = () => {
    if (!importUrl) return;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = importSize.width;
      canvas.height = importSize.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixelColors = Array.from({ length: canvas.height }, (_, y) =>
        Array.from({ length: canvas.width }, (_, x) => {
          const data = context.getImageData(x, y, 1, 1).data;
          if (data[3] < 128) return null;
          return closestColor([data[0], data[1], data[2]], DMC_COLORS);
        }),
      );
      // narrow down to the N most-used threads so "color range" reflects what's actually in the image
      const counts = new Map<string, number>();
      pixelColors
        .flat()
        .forEach(
          (color) =>
            color && counts.set(color.id, (counts.get(color.id) || 0) + 1),
        );
      const palette = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, importSize.colors)
        .map(([id]) => colorById(id)!);
      const cells = pixelColors.map((row) =>
        row.map((color) =>
          color ? closestColor(color.rgb, palette).id : null,
        ),
      );
      setPattern({ width: importSize.width, height: importSize.height, cells });
      setHistory([]);
      setFuture([]);
      setShowImport(false);
    };
    image.src = importUrl;
  };
  const applyBackgroundImage = () => {
    if (!importUrl) return;
    setPattern(makePattern(importSize.width, importSize.height));
    setHistory([]);
    setFuture([]);
    setBackgroundImage(importUrl);
    setShowImport(false);
  };
  const removeBackgroundImage = () => setBackgroundImage(null);
  const exportPdf = () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(24);
    pdf.text(patternName, 18, 24);
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.text(`${pattern.width} x ${pattern.height} stitches`, 18, 34);
    pdf.text(
      `${used.length} colors  |  ${totalStitches} filled stitches`,
      18,
      41,
    );
    const cell = Math.min(6, 170 / Math.max(pattern.width, pattern.height));
    const left = 18;
    const top = 52;
    pdf.setFontSize(Math.max(4, cell * 1.5));
    pattern.cells.forEach((row, r) =>
      row.forEach((id, c) => {
        const x = left + c * cell;
        const y = top + r * cell;
        let faint: [number, number, number] | null = null;
        if (id) {
          // blend toward white for a faint fill, then pick a readable symbol color against it
          faint = colorById(id)!.rgb.map((channel) =>
            Math.round(channel + (255 - channel) * 0.6),
          ) as [number, number, number];
          pdf.setFillColor(...faint);
          pdf.rect(x, y, cell, cell, "F");
        }
        pdf.setDrawColor(120);
        pdf.rect(x, y, cell, cell);
        if (id && faint) {
          const [fr, fg, fb] = faint;
          const luminance = 0.299 * fr + 0.587 * fg + 0.114 * fb;
          const textColor: [number, number, number] =
            luminance > 150 ? [40, 40, 40] : [255, 255, 255];
          pdf.setTextColor(...textColor);
          pdf.text(symbols[id], x + cell / 2, y + cell * 0.72, {
            align: "center",
          });
        }
      }),
    );
    pdf.setFontSize(9);
    pdf.setTextColor(20);
    pdf.text(
      `Pattern grid  |  ${pattern.width} x ${pattern.height}`,
      left,
      top + pattern.height * cell + 10,
    );
    pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text("Color legend", 18, 24);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    used.forEach(([id, count], index) => {
      const color = colorById(id)!;
      const y = 36 + index * 8;
      pdf.setFillColor(...color.rgb);
      pdf.rect(18, y - 4, 5, 5, "F");
      pdf.setTextColor(20);
      pdf.text(
        `${symbols[id]}    DMC ${color.number}    ${color.name}    ${count} stitches`,
        27,
        y,
      );
    });
    pdf.save("threadline-pattern.pdf");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✣</span>
          <div>
            <strong>THREADLINE</strong>
            <span>Märtha's cross-stitch pattern studio</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="button quiet" onClick={() => setShowNew(true)}>
            <Plus size={16} /> New pattern
          </button>
          <button
            className="button quiet"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={16} /> Import image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={openImage}
          />
          <button className="button primary" onClick={exportPdf}>
            <Download size={16} /> Export PDF
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className="sidebar">
          <section className="panel tools-panel">
            <div className="eyebrow">Tools</div>
            <div className="tool-grid">
              {(
                [
                  ["pencil", Pencil, "Pencil"],
                  ["eraser", Eraser, "Eraser"],
                  ["picker", MousePointer2, "Pick color"],
                  ["fill", Wand2, "Fill area"],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  className={`tool ${tool === id ? "active" : ""}`}
                  onClick={() => setTool(id)}
                  title={label}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="history-row">
              <button
                className="icon-button"
                title="Undo"
                disabled={!history.length}
                onClick={undo}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                title="Redo"
                disabled={!future.length}
                onClick={redo}
              >
                <Redo2 size={17} />
              </button>
              <span className="history-label">{tool}</span>
            </div>
          </section>
          <section className="panel palette-panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">DMC palette</div>
                <h2>Choose a thread</h2>
              </div>
              <div className="palette-heading-actions">
                <span className="count">{DMC_COLORS.length}</span>
                <button
                  className="icon-button"
                  title="Expand palette"
                  aria-label="Expand palette"
                  onClick={() => setPaletteOpen(true)}
                >
                  <Maximize2 size={15} />
                </button>
              </div>
            </div>
            <label className="search-box">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search number or name"
              />
            </label>
            <div className="palette-grid">
              {sidebarColors.map((color) => (
                <button
                  key={color.id}
                  className={`swatch ${selectedColor === color.id ? "selected" : ""}`}
                  title={`DMC ${color.number} ${color.name}`}
                  aria-label={`DMC ${color.number} ${color.name}`}
                  onClick={() => {
                    setSelectedColor(color.id);
                    setTool("pencil");
                  }}
                >
                  <span style={{ background: rgb(color) }}></span>
                  <b>{color.number}</b>
                </button>
              ))}
            </div>
          </section>
        </aside>
        <section className="canvas-area">
          <div className="canvas-toolbar">
            <div>
              <div className="eyebrow">Working pattern</div>
              <input
                className="pattern-title"
                value={patternName}
                onChange={(event) => setPatternName(event.target.value)}
                aria-label="Pattern name"
              />
            </div>
            <div className="canvas-actions">
              <button
                className="icon-button"
                title="Reset zoom"
                onClick={() => setZoom(1)}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className="icon-button"
                title="Zoom out"
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
              >
                <Minus size={16} />
              </button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                className="icon-button"
                title="Zoom in"
                onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
              >
                <Plus size={16} />
              </button>
              <span className="divider" />
              <button className="icon-button" title="Grid visibility">
                <Grid3X3 size={17} />
              </button>
              {backgroundImage && (
                <button
                  className="icon-button"
                  title="Remove background image"
                  onClick={removeBackgroundImage}
                >
                  <ImageOff size={17} />
                </button>
              )}
            </div>
          </div>
          <div className="canvas-wrap">
            <div
              className="ruler top-ruler"
              style={{ width: pattern.width * 28 * zoom }}
            >
              {Array.from({ length: pattern.width }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <div
              className="ruler side-ruler"
              style={{ height: pattern.height * 28 * zoom }}
            >
              {Array.from({ length: pattern.height }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <svg
              ref={svgRef}
              className="stitch-canvas"
              role="grid"
              aria-label="Stitch pattern grid"
              width={pattern.width * 28 * zoom}
              height={pattern.height * 28 * zoom}
              viewBox={`0 0 ${pattern.width * 28} ${pattern.height * 28}`}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onPointerLeave={pointerUp}
            >
              {backgroundImage && (
                <image
                  href={backgroundImage}
                  x={0}
                  y={0}
                  width={pattern.width * 28}
                  height={pattern.height * 28}
                  preserveAspectRatio="none"
                  opacity={0.9}
                />
              )}
              {pattern.cells.map((row, r) =>
                row.map((id, c) => (
                  <g key={`${r}-${c}`} className="cell">
                    <rect
                      x={c * 28}
                      y={r * 28}
                      width="28"
                      height="28"
                      className="cell-bg"
                      style={
                        id
                          ? { fill: rgb(colorById(id)) }
                          : backgroundImage
                            ? { fill: "transparent" }
                            : undefined
                      }
                    />
                  </g>
                )),
              )}
            </svg>
          </div>
          <div className="canvas-footer">
            <span>
              Click or drag to stitch · right-click (or drag) to erase
            </span>
            <span>
              <b>
                {pattern.width} × {pattern.height}
              </b>{" "}
              stitches
            </span>
          </div>
        </section>
        <aside className="inspector">
          <section className="panel selected-panel">
            <div className="eyebrow">Selected thread</div>
            <div className="selected-color">
              <span
                className="large-swatch"
                style={{ background: rgb(colorById(selectedColor)) }}
              />
              <div>
                <strong>DMC {selectedColor}</strong>
                <span>{colorById(selectedColor)?.name}</span>
              </div>
            </div>
          </section>
          <section className="panel stats-panel">
            <div className="eyebrow">Pattern notes</div>
            <div className="stat">
              <span>Filled stitches</span>
              <strong>{totalStitches.toLocaleString()}</strong>
            </div>
            <div className="stat">
              <span>Colors used</span>
              <strong>{used.length}</strong>
            </div>
            <div className="stat">
              <span>Finished size</span>
              <strong>
                {((pattern.width / 16) * 2.54).toFixed(1)} ×{" "}
                {((pattern.height / 16) * 2.54).toFixed(1)} cm
              </strong>
            </div>
          </section>
          <section className="panel used-panel">
            <div className="section-heading">
              <div className="eyebrow">Used colors</div>
              <span className="count">{used.length}</span>
            </div>
            {used.length ? (
              used.map(([id, count]) => (
                <button
                  className="used-color"
                  key={id}
                  onClick={() => setSelectedColor(id)}
                >
                  <span
                    className="mini-swatch"
                    style={{ background: rgb(colorById(id)) }}
                  />
                  <span>
                    <b>
                      {symbols[id]} · DMC {id}
                    </b>
                    <small>{colorById(id)?.name}</small>
                  </span>
                  <em>{count}</em>
                </button>
              ))
            ) : (
              <p className="empty">Your used threads will appear here.</p>
            )}
          </section>
        </aside>
      </main>
      {showNew && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={createPattern}>
            <button
              type="button"
              className="close"
              onClick={() => setShowNew(false)}
            >
              <X size={18} />
            </button>
            <div className="eyebrow">Start fresh</div>
            <h2>New pattern</h2>
            <p>Choose the stitch dimensions for your blank canvas.</p>
            {totalStitches > 0 && (
              <div className="modal-warning">
                <span>
                  You have {totalStitches.toLocaleString()} stitch
                  {totalStitches === 1 ? "" : "es"} in "{patternName}" that
                  haven't been exported. Creating a new pattern will discard
                  them.
                </span>
                <button
                  type="button"
                  className="button quiet"
                  onClick={exportPdf}
                >
                  <Download size={14} /> Export PDF first
                </button>
              </div>
            )}
            <label className="form-row-single">
              Name
              <input name="name" type="text" defaultValue="Untitled sampler" />
            </label>
            <div className="form-row">
              <label>
                Width
                <input
                  name="width"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="32"
                />
              </label>
              <label>
                Height
                <input
                  name="height"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="24"
                />
              </label>
            </div>
            <button className="button primary" type="submit">
              Create pattern
            </button>
          </form>
        </div>
      )}
      {showImport && (
        <div className="modal-backdrop">
          <div className="modal import-modal">
            <button
              type="button"
              className="close"
              onClick={() => setShowImport(false)}
            >
              <X size={18} />
            </button>
            <div className="eyebrow">Local image conversion</div>
            <h2>
              {importMode === "stitch"
                ? "Turn image into stitches"
                : "Use image as background"}
            </h2>
            <div className="import-preview">
              <img src={importUrl!} alt="Selected source preview" />
              <div>
                <Sparkles size={18} />
                <span>Everything stays in your browser.</span>
              </div>
            </div>
            <div className="import-mode-tabs">
              <button
                type="button"
                className={`import-mode-tab ${importMode === "stitch" ? "active" : ""}`}
                onClick={() => setImportMode("stitch")}
              >
                Convert to stitches
              </button>
              <button
                type="button"
                className={`import-mode-tab ${importMode === "background" ? "active" : ""}`}
                onClick={() => setImportMode("background")}
              >
                Use as background
              </button>
            </div>
            {importMode === "stitch" ? (
              <>
                <div className="form-row">
                  <label>
                    Width
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={importSize.width}
                      onChange={(event) =>
                        setImportSize({
                          ...importSize,
                          width: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Height
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={importSize.height}
                      onChange={(event) =>
                        setImportSize({
                          ...importSize,
                          height: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Color range
                    <input
                      type="number"
                      min="2"
                      max="40"
                      value={importSize.colors}
                      onChange={(event) =>
                        setImportSize({
                          ...importSize,
                          colors: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <button className="button primary" onClick={convertImage}>
                  <Wand2 size={16} /> Generate pattern
                </button>
              </>
            ) : (
              <>
                <p className="import-hint">
                  Choose the grid size, and the image will be placed behind
                  it so you can stitch over it by hand. You can remove it
                  again at any time.
                </p>
                <div className="form-row">
                  <label>
                    Width
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={importSize.width}
                      onChange={(event) =>
                        setImportSize({
                          ...importSize,
                          width: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Height
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={importSize.height}
                      onChange={(event) =>
                        setImportSize({
                          ...importSize,
                          height: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  className="button primary"
                  onClick={applyBackgroundImage}
                >
                  <ImagePlus size={16} /> Set as background
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {paletteOpen && (
        <div className="modal-backdrop" onClick={() => setPaletteOpen(false)}>
          <div
            className="modal palette-modal"
            role="dialog"
            aria-modal="true"
            aria-label="DMC palette"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="close"
              aria-label="Close palette"
              onClick={() => setPaletteOpen(false)}
            >
              <X size={18} />
            </button>
            <div className="eyebrow">DMC palette</div>
            <h2>Choose a thread</h2>
            <label className="search-box">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search number or name"
                autoFocus
              />
            </label>
            <div className="palette-filters">
              <div
                className="family-chips"
                role="group"
                aria-label="Filter by color family"
              >
                <button
                  className={`chip ${familyFilter === null ? "active" : ""}`}
                  aria-pressed={familyFilter === null}
                  onClick={() => setFamilyFilter(null)}
                >
                  All
                </button>
                {COLOR_FAMILIES.map((family) => (
                  <button
                    key={family}
                    className={`chip ${familyFilter === family ? "active" : ""}`}
                    aria-pressed={familyFilter === family}
                    onClick={() =>
                      setFamilyFilter((current) =>
                        current === family ? null : family,
                      )
                    }
                  >
                    {family}
                  </button>
                ))}
              </div>
              <label className="sort-select">
                Sort
                <select
                  value={paletteSort}
                  onChange={(event) =>
                    setPaletteSort(
                      event.target.value as "family" | "number" | "name",
                    )
                  }
                >
                  <option value="family">Color family</option>
                  <option value="number">DMC number</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            <div className="palette-grid palette-grid-expanded">
              {modalColors.map((color) => (
                <button
                  key={color.id}
                  className={`swatch ${selectedColor === color.id ? "selected" : ""}`}
                  title={`DMC ${color.number} ${color.name}`}
                  aria-label={`DMC ${color.number} ${color.name}`}
                  onClick={() => {
                    setSelectedColor(color.id);
                    setTool("pencil");
                  }}
                >
                  <span style={{ background: rgb(color) }}></span>
                  <b>{color.number}</b>
                </button>
              ))}
              {!modalColors.length && (
                <p className="empty">No colors match your filters.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
