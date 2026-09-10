import {
  createQrCodeSvg,
  createQrMatrix,
  renderQrCodeToCanvas,
} from './qrCodeGenerator';

describe('qrCodeGenerator', () => {
  test('should generate matrix for URL text', () => {
    const matrixData = createQrMatrix('https://example.com');
    expect(matrixData).toBeDefined();
    expect(matrixData.size).toBeGreaterThanOrEqual(21);
    expect(Array.isArray(matrixData.modules)).toBe(true);
    expect(matrixData.modules.length).toBe(matrixData.size);
  });

  test('should render onto HTML5 canvas', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = jest.fn().mockReturnValue({
      fillStyle: '',
      fillRect: jest.fn(),
    });

    renderQrCodeToCanvas(canvas, 'https://test.com', {
      margin: 4,
      dark: '#000000',
      light: '#ffffff',
    });

    const ctx = canvas.getContext('2d');
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  test('should create a scalable SVG with custom colors and rounded modules', () => {
    const svg = createQrCodeSvg('https://example.com', {
      dark: '#123456',
      light: '#ffffff',
      rounded: true,
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('rx=');
  });
});
