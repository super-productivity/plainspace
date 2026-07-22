import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import MobileQuickActions from './MobileQuickActions';

interface VerticalRect {
  top: number;
  bottom: number;
}

const MOBILE_QUERY = '(max-width: 760px)';
let mobileMatches = true;
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();

function setMobile(matches: boolean) {
  mobileMatches = matches;
  const event = { matches, media: MOBILE_QUERY } as MediaQueryListEvent;
  mediaListeners.forEach((listener) => listener(event));
}

function domRect({ top, bottom }: VerticalRect): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

function renderQuickActions(
  add: VerticalRect | null,
  scratchpad: VerticalRect | null,
  alwaysVisible = false,
) {
  let addRect = add;
  let scratchpadRect = scratchpad;
  const measureAdd = vi.fn(() => domRect(addRect!));
  const measureScratchpad = vi.fn(() => domRect(scratchpadRect!));

  const view = render(() => (
    <>
      {add && (
        <div data-testid="add-item-body">
          <input
            data-testid="add-item-input"
            ref={(element) =>
              vi.spyOn(element, 'getBoundingClientRect').mockImplementation(measureAdd)
            }
          />
        </div>
      )}
      {scratchpad && (
        <div data-testid="scratchpad-body">
          <button
            type="button"
            data-testid="scratchpad-content"
            ref={(element) =>
              vi.spyOn(element, 'getBoundingClientRect').mockImplementation(measureScratchpad)
            }
          />
        </div>
      )}
      <MobileQuickActions alwaysVisible={alwaysVisible} />
    </>
  ));

  return {
    bar: () => view.container.querySelector<HTMLElement>('[role="group"]')!,
    measureAdd,
    measureScratchpad,
    setRects(nextAdd: VerticalRect, nextScratchpad: VerticalRect) {
      addRect = nextAdd;
      scratchpadRect = nextScratchpad;
    },
    collapseTargets() {
      view.getByTestId('add-item-body').setAttribute('aria-hidden', 'true');
      view.getByTestId('scratchpad-body').setAttribute('aria-hidden', 'true');
    },
    notifyLayoutChange() {
      view.getByTestId('add-item-body').append(document.createElement('span'));
    },
  };
}

function expectHidden(bar: HTMLElement) {
  expect(bar.getAttribute('data-hidden')).toBe('true');
  expect(bar.getAttribute('aria-hidden')).toBe('true');
  expect(bar.inert).toBe(true);
}

function expectVisible(bar: HTMLElement) {
  expect(bar.getAttribute('data-hidden')).toBe(null);
  expect(bar.getAttribute('aria-hidden')).toBe(null);
  expect(bar.inert).toBe(false);
}

describe('MobileQuickActions', () => {
  beforeEach(() => {
    setMobile(true);
    const mediaQuery = {
      media: MOBILE_QUERY,
      get matches() {
        return mobileMatches;
      },
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        mediaListeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as MediaQueryList;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQuery),
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  });

  afterEach(() => {
    mediaListeners.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips layout measurements outside the mobile breakpoint and starts after entering it', async () => {
    setMobile(false);
    const fixture = renderQuickActions({ top: -166, bottom: -120 }, { top: 900, bottom: 1000 });

    expect(fixture.measureAdd).not.toHaveBeenCalled();
    expect(fixture.measureScratchpad).not.toHaveBeenCalled();
    expectHidden(fixture.bar());

    setMobile(true);
    await waitFor(() => expectVisible(fixture.bar()));
    expect(fixture.measureAdd).toHaveBeenCalledTimes(1);
    expect(fixture.measureScratchpad).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated viewport updates into one layout measurement', async () => {
    const fixture = renderQuickActions({ top: -166, bottom: -120 }, { top: 900, bottom: 1000 });
    await waitFor(() => expectVisible(fixture.bar()));
    fixture.measureAdd.mockClear();
    fixture.measureScratchpad.mockClear();

    fireEvent.scroll(window);
    fireEvent.resize(window);
    fireEvent.scroll(window);

    await waitFor(() => expect(fixture.measureAdd).toHaveBeenCalledTimes(1));
    expect(fixture.measureScratchpad).toHaveBeenCalledTimes(1);
  });

  it('stays hidden and unfocusable while both direct edit targets are visible', async () => {
    const { bar } = renderQuickActions({ top: 120, bottom: 166 }, { top: 240, bottom: 340 });

    await waitFor(() => expectHidden(bar()));
  });

  it('stays visible when the task composer is offscreen', async () => {
    const { bar } = renderQuickActions({ top: -166, bottom: -120 }, { top: 240, bottom: 340 });

    await waitFor(() => expectVisible(bar()));
  });

  it('stays visible when the scratchpad editor is offscreen', async () => {
    const { bar } = renderQuickActions({ top: 120, bottom: 166 }, { top: 900, bottom: 1000 });

    await waitFor(() => expectVisible(bar()));
  });

  it('stays visible while both targets are offscreen, regardless of scroll direction', async () => {
    let scrollY = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    const fixture = renderQuickActions({ top: -166, bottom: -120 }, { top: 1100, bottom: 1200 });

    await waitFor(() => expectVisible(fixture.bar()));

    scrollY = 200;
    fireEvent.scroll(window);
    await waitFor(() => expectVisible(fixture.bar()));

    scrollY = 120;
    fireEvent.scroll(window);
    await waitFor(() => expectVisible(fixture.bar()));

    fixture.setRects({ top: 120, bottom: 166 }, { top: 240, bottom: 340 });
    fireEvent.resize(window);
    await waitFor(() => expectHidden(fixture.bar()));
  });

  it('stays hidden when either canonical target is missing', async () => {
    const { bar } = renderQuickActions({ top: 920, bottom: 966 }, null);

    await waitFor(() => expectHidden(bar()));
  });

  it('reacts when visible targets are collapsed without scrolling', async () => {
    const fixture = renderQuickActions({ top: 120, bottom: 166 }, { top: 240, bottom: 340 });

    await waitFor(() => expectHidden(fixture.bar()));

    fixture.collapseTargets();
    await waitFor(() => expectVisible(fixture.bar()));
  });

  it('reacts when a layout change moves both targets offscreen', async () => {
    const fixture = renderQuickActions({ top: 120, bottom: 166 }, { top: 240, bottom: 340 });

    await waitFor(() => expectHidden(fixture.bar()));

    fixture.setRects({ top: -166, bottom: -120 }, { top: 900, bottom: 1000 });
    fixture.notifyLayoutChange();
    await waitFor(() => expectVisible(fixture.bar()));
  });

  it('can stay visible as an interactive inline styleguide specimen', async () => {
    const { bar } = renderQuickActions({ top: 120, bottom: 166 }, { top: 240, bottom: 340 }, true);

    await waitFor(() => expectVisible(bar()));
  });
});
