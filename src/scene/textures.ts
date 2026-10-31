import * as THREE from 'three';
import type { Side } from '../../shared/whisper';

const GREY = '#8f9cac';
const WHITE = '#e9edf3';
const FONT = '"Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif';
const ACCENTS: Record<Side, string> = { a: '#91B7CF', b: '#D3A284' };

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable');
  return { element, context };
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of Array.from(text)) {
    const next = line + char;
    if (context.measureText(next).width > maxWidth && line) {
      lines.push(line); line = char;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && Array.from(text).length > Array.from(lines.join('')).length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

function rounded(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function finish(element: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export interface CardOptions {
  title: string;
  value?: string;
  detail?: string;
  accent?: string;
  muted?: boolean;
  seal?: string;
}

/** A readable holographic card for the negotiation table. */
export function cardTexture({ title, value, detail = '', accent = ACCENTS.a, muted = false, seal }: CardOptions): THREE.CanvasTexture {
  const { element, context } = canvas(640, 400);
  context.clearRect(0, 0, 640, 400);
  context.fillStyle = muted ? 'rgba(18,24,33,.86)' : 'rgba(20,27,38,.94)';
  rounded(context, 8, 8, 624, 384, 22); context.fill();
  context.strokeStyle = muted ? 'rgba(120,136,152,.45)' : accent;
  context.lineWidth = 2; rounded(context, 8, 8, 624, 384, 22); context.stroke();
  context.fillStyle = accent;
  context.fillRect(28, 30, 70, 3);

  context.font = `600 32px ${FONT}`;
  context.fillStyle = muted ? GREY : accent;
  context.fillText(title, 28, 78);

  if (value) {
    context.font = `600 72px ${FONT}`;
    context.fillStyle = muted ? '#b7c1ce' : WHITE;
    context.fillText(value, 28, 170);
  }

  if (detail) {
    context.font = `28px ${FONT}`;
    context.fillStyle = muted ? '#7f8b9b' : GREY;
    const lines = wrap(context, detail, 584, 3);
    lines.forEach((line, index) => context.fillText(line, 28, (value ? 238 : 140) + index * 42));
  }

  if (seal && !muted) {
    context.fillStyle = 'rgba(122,42,34,.92)';
    context.beginPath(); context.arc(556, 84, 40, 0, Math.PI * 2); context.fill();
    context.strokeStyle = 'rgba(214,164,124,.9)'; context.lineWidth = 3;
    context.beginPath(); context.arc(556, 84, 29, 0, Math.PI * 2); context.stroke();
    context.fillStyle = '#e6c9a8'; context.font = `600 21px ${FONT}`; context.textAlign = 'center';
    context.fillText(seal, 556, 92); context.textAlign = 'left';
  }

  context.font = `20px ${FONT}`;
  context.fillStyle = 'rgba(145,183,207,.55)';
  context.fillText('◇  公开桌面', 28, 360);
  return finish(element);
}

/** A small paper tag lying beside the trade trays. Never a large floating plaque. */
export function tagTexture(text: string, accent = ACCENTS.a, muted = false): THREE.CanvasTexture {
  const { element, context } = canvas(512, 128);
  context.fillStyle = muted ? 'rgba(201,193,176,.86)' : 'rgba(227,214,188,.94)';
  rounded(context, 6, 6, 500, 116, 10); context.fill();
  context.strokeStyle = muted ? 'rgba(120,112,98,.6)' : 'rgba(168,144,105,.9)'; context.lineWidth = 3;
  rounded(context, 6, 6, 500, 116, 10); context.stroke();
  context.fillStyle = accent;
  context.fillRect(6, 6, 12, 116);
  context.fillStyle = muted ? '#5d5649' : '#3b3227';
  context.font = `600 46px ${FONT}`;
  const lines = wrap(context, text, 430, 1);
  context.fillText(lines[0] ?? text, 40, 80);
  return finish(element);
}

export function nameTexture(name: string, role: string, side: Side): THREE.CanvasTexture {
  const { element, context } = canvas(512, 144);
  const accent = ACCENTS[side];
  context.fillStyle = 'rgba(12,17,24,.78)';
  rounded(context, 6, 6, 500, 132, 16); context.fill();
  context.strokeStyle = `${accent}99`; context.lineWidth = 2;
  rounded(context, 6, 6, 500, 132, 16); context.stroke();
  context.fillStyle = accent;
  context.font = `600 38px ${FONT}`;
  context.fillText(name, 26, 62);
  context.fillStyle = GREY;
  context.font = `22px ${FONT}`;
  context.fillText(role, 26, 104);
  context.fillStyle = `${accent}22`;
  context.fillRect(26, 116, 460, 2);
  return finish(element);
}

export function plaqueTexture(text: string, accent = ACCENTS.a): THREE.CanvasTexture {
  const { element, context } = canvas(512, 128);
  context.fillStyle = 'rgba(14,20,29,.82)';
  rounded(context, 4, 4, 504, 120, 12); context.fill();
  context.strokeStyle = `${accent}77`; context.lineWidth = 2;
  rounded(context, 4, 4, 504, 120, 12); context.stroke();
  context.fillStyle = accent;
  context.font = `600 24px ${FONT}`;
  const lines = wrap(context, text, 460, 2);
  lines.forEach((line, index) => context.fillText(line, 24, 50 + index * 34));
  return finish(element);
}

/** Procedural rain streaks for the storm window. Additive in the scene. */
export function rainTexture(): THREE.CanvasTexture {
  const { element, context } = canvas(512, 512);
  let seed = 41;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 130; i++) {
    const x = next() * 512, y = next() * 512, length = 18 + next() * 62;
    context.strokeStyle = `rgba(176, 210, 240, ${.08 + next() * .24})`;
    context.lineWidth = .7 + next() * 1.6;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x - 5, y + length); context.stroke();
  }
  const texture = finish(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 2.2);
  return texture;
}

/** Soft harbour haze used on layered fog planes. */
export function fogTexture(): THREE.CanvasTexture {
  const { element, context } = canvas(512, 256);
  let seed = 73;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const x = next() * 512, y = next() * 256, r = 42 + next() * 120;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(206, 218, 222, ${.05 + next() * .1})`);
    gradient.addColorStop(1, 'rgba(206, 218, 222, 0)');
    context.fillStyle = gradient;
    context.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = finish(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.4, 1);
  return texture;
}

/** A brass tide dial without hands; the scene geometry adds the hands. */
export function clockTexture(label = '潮汐'): THREE.CanvasTexture {
  const { element, context } = canvas(256, 256);
  context.fillStyle = '#0f151b'; context.beginPath(); context.arc(128, 128, 124, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#c9a173'; context.lineWidth = 4; context.beginPath(); context.arc(128, 128, 116, 0, Math.PI * 2); context.stroke();
  context.strokeStyle = 'rgba(201, 161, 115, .55)'; context.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2, inner = i % 6 === 0 ? 90 : 100;
    context.beginPath();
    context.moveTo(128 + Math.sin(angle) * inner, 128 - Math.cos(angle) * inner);
    context.lineTo(128 + Math.sin(angle) * 112, 128 - Math.cos(angle) * 112);
    context.stroke();
  }
  context.fillStyle = '#d3a284'; context.font = `600 30px ${FONT}`; context.textAlign = 'center';
  context.fillText(label, 128, 176);
  context.fillStyle = '#7e8b9b'; context.font = `19px ${FONT}`;
  context.fillText('满潮 · 封港', 128, 202);
  context.textAlign = 'left';
  return finish(element);
}

/** Cream contract paper used for the closing ceremony. Only public data is printed. */
export function contractTexture(price: number): THREE.CanvasTexture {
  const { element, context } = canvas(640, 400);
  context.fillStyle = '#e6dbc2'; rounded(context, 0, 0, 640, 400, 0); context.fill();
  context.fillStyle = '#d8c9a9'; context.fillRect(0, 0, 640, 18);
  context.strokeStyle = '#b8a174'; context.lineWidth = 2; context.strokeRect(24, 38, 592, 324);
  context.fillStyle = '#3c342a'; context.font = `600 32px ${FONT}`; context.fillText('成交协议', 48, 94);
  context.fillStyle = '#6b5c45'; context.font = `23px ${FONT}`; context.fillText('双方代理人公开确认 · 第三幕后执行', 48, 132);
  context.fillStyle = '#2c2923'; context.font = `600 64px ${FONT}`; context.fillText(`${price} 枚筹码`, 48, 214);
  context.fillStyle = '#5f5340'; context.font = `24px ${FONT}`; context.fillText('报价与接受均记录在公开桌面', 48, 258);
  context.strokeStyle = '#b49a6c'; context.lineWidth = 1; context.beginPath(); context.moveTo(48, 284); context.lineTo(592, 284); context.stroke();
  context.fillStyle = '#6b5c45'; context.font = `21px ${FONT}`; context.fillText('低语代理人 · 公开协议副本', 48, 320);
  context.strokeStyle = '#b33a2f'; context.lineWidth = 5; context.beginPath(); context.arc(534, 306, 44, 0, Math.PI * 2); context.stroke();
  context.fillStyle = '#b33a2f'; context.font = `600 19px ${FONT}`; context.textAlign = 'center';
  context.fillText('已成交', 534, 313); context.textAlign = 'left';
  return finish(element);
}

export function dispose(...textures: (THREE.CanvasTexture | null | undefined)[]) {
  for (const texture of textures) texture?.dispose();
}
