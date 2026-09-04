import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_MIME,
  buildImageDataUrl,
  isImageMimeType,
  isLikelyImageBase64,
  normalizeBase64Input,
  parseImageBase64,
} from '../image-base64';

const base64Of = (length: number, char = 'A'): string => char.repeat(length);

describe('normalizeBase64Input', () => {
  it('去除首尾空白与内部所有空白字符', () => {
    expect(normalizeBase64Input('  YWJj ZGVm\n\tZw==  ')).toBe('YWJjZGVmZw==');
  });

  it('空串原样返回', () => {
    expect(normalizeBase64Input('')).toBe('');
  });
});

describe('buildImageDataUrl', () => {
  it('默认 MIME 且归一化 base64', () => {
    expect(buildImageDataUrl(' YWJj\nZGVm ')).toBe('data:image/png;base64,YWJjZGVm');
  });

  it('使用传入的 MIME', () => {
    expect(buildImageDataUrl('YWJj', 'image/jpeg')).toBe('data:image/jpeg;base64,YWJj');
  });
});

describe('isImageMimeType', () => {
  it('识别 image/ 前缀并忽略大小写与首尾空白', () => {
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isImageMimeType('IMAGE/JPEG')).toBe(true);
    expect(isImageMimeType('  image/svg+xml  ')).toBe(true);
  });

  it('拒绝非 image/ 前缀', () => {
    expect(isImageMimeType('text/plain')).toBe(false);
    expect(isImageMimeType('application/json')).toBe(false);
  });

  it('拒绝空值', () => {
    expect(isImageMimeType('')).toBe(false);
    expect(isImageMimeType('   ')).toBe(false);
  });
});

describe('isLikelyImageBase64', () => {
  it('77 字符（< 80 阈值）拒绝', () => {
    expect(isLikelyImageBase64(base64Of(77))).toBe(false);
  });

  it('80 字符（= 阈值）接受', () => {
    expect(isLikelyImageBase64(base64Of(80))).toBe(true);
  });

  it('81 字符（> 阈值）接受', () => {
    expect(isLikelyImageBase64(base64Of(81))).toBe(true);
  });

  it('先做空白归一化再判断长度', () => {
    expect(isLikelyImageBase64(`  ${base64Of(40)} \n ${base64Of(40)}  `)).toBe(true);
  });

  it('接受合法填充', () => {
    expect(isLikelyImageBase64(`${base64Of(78)}==`)).toBe(true);
  });

  it('拒绝非法 base64 字符与非法填充', () => {
    expect(isLikelyImageBase64(`${base64Of(79)}!`)).toBe(false);
    expect(isLikelyImageBase64(`${base64Of(78)}@#`)).toBe(false);
    expect(isLikelyImageBase64(`${base64Of(77)}===`)).toBe(false);
  });

  it('拒绝 data URL（含 : ; , 非法字符）', () => {
    expect(isLikelyImageBase64(`data:image/png;base64,${base64Of(80)}`)).toBe(false);
  });
});

describe('parseImageBase64', () => {
  it('空串或纯空白返回 null', () => {
    expect(parseImageBase64('')).toBeNull();
    expect(parseImageBase64('   ')).toBeNull();
    expect(parseImageBase64('\n\t')).toBeNull();
  });

  it('合法 data URL 解析出 MIME 与归一化 base64', () => {
    expect(parseImageBase64('data:image/png;base64, YWJj ZGVm')).toEqual({
      mime: 'image/png',
      base64: 'YWJjZGVm',
      dataUrl: 'data:image/png;base64,YWJjZGVm',
    });
  });

  it('带参数 MIME 的 data URL 正确提取 image/ 前缀 MIME', () => {
    const raw = base64Of(80);
    expect(parseImageBase64(`data:image/svg+xml;charset=utf-8;base64,${raw}`)).toEqual({
      mime: 'image/svg+xml',
      base64: raw,
      dataUrl: `data:image/svg+xml;base64,${raw}`,
    });
  });

  it('拒绝非 image/ 前缀的 data URL', () => {
    expect(parseImageBase64(`data:text/plain;base64,${base64Of(80)}`)).toBeNull();
    expect(parseImageBase64(`data:application/json;base64,${base64Of(80)}`)).toBeNull();
  });

  it('拒绝 data URL 中非法的 base64 载荷', () => {
    expect(parseImageBase64('data:image/png;base64,!!!not-base64!!!')).toBeNull();
  });

  it('拒绝缺少 base64 载荷的 data URL', () => {
    expect(parseImageBase64('data:image/png;base64,')).toBeNull();
  });

  it('裸 base64（>= 80 字符）回退为默认 MIME', () => {
    const raw = base64Of(80);
    expect(parseImageBase64(raw)).toEqual({
      mime: DEFAULT_IMAGE_MIME,
      base64: raw,
      dataUrl: `data:${DEFAULT_IMAGE_MIME};base64,${raw}`,
    });
  });

  it('短于阈值的裸 base64 返回 null', () => {
    expect(parseImageBase64(base64Of(79))).toBeNull();
  });

  it('裸 base64 先归一化再回退默认 MIME', () => {
    const raw = base64Of(80);
    expect(parseImageBase64(`  ${raw.slice(0, 40)} \n ${raw.slice(40)}  `)?.base64).toBe(raw);
  });
});
