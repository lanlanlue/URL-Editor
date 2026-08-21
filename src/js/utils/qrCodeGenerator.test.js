import { createQrMatrix, renderQrCodeToCanvas } from './qrCodeGenerator';

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
});
