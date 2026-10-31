import { buildUtmUrl } from '../src/js/core/utmBuilder.js';

describe('utmModal', () => {
  let initUtmModal;
  let openUtmModal;
  let currentI18n;
  let copyBtn;
  let outputInput;
  let baseUrlInput;
  let sourceInput;
  let mediumInput;
  let campaignInput;
  let dialog;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const i18nModule = await import('i18next');
    currentI18n = i18nModule.default || i18nModule;

    const utmModule = await import('../src/js/ui/modals/utmModal.js');
    initUtmModal = utmModule.initUtmModal;
    openUtmModal = utmModule.openUtmModal;

    document.body.innerHTML = `
      <dialog id="utm-modal">
        <select id="utm-preset"></select>
        <button id="utm-close-btn">Close</button>
        <input id="utm-base-url" value="" />
        <input data-utm-key="utm_source" id="utm-source" value="" />
        <input data-utm-key="utm_medium" id="utm-medium" value="" />
        <input data-utm-key="utm_campaign" id="utm-campaign" value="" />
        <input data-utm-key="utm_term" id="utm-term" value="" />
        <input data-utm-key="utm_content" id="utm-content" value="" />
        <div id="utm-error" class="hidden"></div>
        <input id="utm-output" value="" />
        <button id="utm-copy-btn">Copy UTM</button>
      </dialog>
    `;

    dialog = document.getElementById('utm-modal');
    dialog.showModal = jest.fn(() => {
      dialog.open = true;
    });
    dialog.close = jest.fn(() => {
      dialog.open = false;
    });

    baseUrlInput = document.getElementById('utm-base-url');
    sourceInput = document.getElementById('utm-source');
    mediumInput = document.getElementById('utm-medium');
    campaignInput = document.getElementById('utm-campaign');
    outputInput = document.getElementById('utm-output');
    copyBtn = document.getElementById('utm-copy-btn');

    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('buildUtmUrl works properly when constructing UTM links', () => {
    const url = buildUtmUrl('https://example.com/landing', {
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'spring_promo',
    });

    expect(url).toContain('https://example.com/landing?');
    expect(url).toContain('utm_source=newsletter');
    expect(url).toContain('utm_medium=email');
    expect(url).toContain('utm_campaign=spring_promo');
  });

  test('modal inputs trigger buildUtmUrl and render output properly', () => {
    initUtmModal();

    baseUrlInput.value = 'https://example.com';
    sourceInput.value = 'facebook';
    mediumInput.value = 'social';
    campaignInput.value = 'rebranding';

    baseUrlInput.dispatchEvent(new Event('input'));

    expect(outputInput.value).toBe(
      'https://example.com/?utm_source=facebook&utm_medium=social&utm_campaign=rebranding'
    );
  });

  test('copy button calls i18next.t without throwing ReferenceError and copies text', async () => {
    initUtmModal();

    baseUrlInput.value = 'https://example.com';
    sourceInput.value = 'google';
    mediumInput.value = 'cpc';
    baseUrlInput.dispatchEvent(new Event('input'));

    expect(outputInput.value).toBeTruthy();

    const tSpy = jest.spyOn(currentI18n, 't').mockReturnValue('已複製');

    copyBtn.click();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      outputInput.value
    );

    await Promise.resolve();

    expect(tSpy).toHaveBeenCalledWith('urlList.card.copied');
    expect(copyBtn.textContent).toBe('已複製');

    jest.advanceTimersByTime(1000);
    expect(copyBtn.textContent).toBe('Copy UTM');
  });

  test('openUtmModal opens dialog and renders URL', () => {
    initUtmModal();
    openUtmModal('https://initial-site.com');
    expect(baseUrlInput.value).toBe('https://initial-site.com');
    expect(dialog.showModal).toHaveBeenCalled();
  });
});
