describe.each([false, true])('privacy-first ads (cloud=%s)', (cloud) => {
  test.each(['/', '/app'])(
    'never loads third-party code or probes session at %s',
    async (pathname) => {
      jest.resetModules();
      jest.doMock('./runtimeConfig.js', () => ({ CLOUD_ENABLED: cloud }));
      window.history.replaceState({}, '', pathname);
      document.head.innerHTML = '';
      global.fetch = jest.fn().mockResolvedValue({ status: 401 });
      const { initGuestAds } = await import('./guestAds.js');
      await initGuestAds();
      expect(document.querySelector('script')).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
