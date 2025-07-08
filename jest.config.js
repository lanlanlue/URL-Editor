module.exports = {
  // 使用 jsdom 模擬瀏覽器環境，讓您可以測試 DOM 操作
  testEnvironment: 'jest-environment-jsdom',
  // 設定檔案轉換器，告訴 Jest 如何處理 JS 檔案
  // 這裡我們直接為 babel-jest 提供設定，避免使用 babel.config.js
  transform: {
    // 使用 babel-jest 處理所有 .js 結尾的檔案
    '^.+\\.js$': [
      'babel-jest',
      { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
    ],
  },
  // 測試檔案的匹配模式
  testMatch: ['**/src/**/*.test.js'],
  // 在測試環境設定前執行的檔案，可用於 polyfill
  setupFiles: ['./jest.setup.js'],
  // 載入 jest-dom 的自訂斷言，例如 .toBeInTheDocument()
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  // 指定從哪些檔案收集覆蓋率資訊
  collectCoverageFrom: [
    'src/js/**/*.js',
    // 排除不需計算覆蓋率的檔案
    '!src/js/**/*.test.js',
    '!src/js/i18n.js',
  ],
};
