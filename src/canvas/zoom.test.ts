import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasView } from './stores';

describe('canvas zoom', () => {
  beforeEach(() => useCanvasView.setState({ zoom: 1, auto: true }));

  it('zooms automatically until the user picks a zoom', () => {
    useCanvasView.getState().setAutoZoom(0.75);
    expect(useCanvasView.getState()).toMatchObject({ zoom: 0.75, auto: true });
    useCanvasView.getState().setZoom(1);
    expect(useCanvasView.getState()).toMatchObject({ zoom: 1, auto: false });
    // An explicit choice sticks: automatic zoom no longer changes it.
    useCanvasView.getState().setAutoZoom(0.5);
    expect(useCanvasView.getState().zoom).toBe(1);
    expect(JSON.parse(window.localStorage.getItem('uiex-builder:canvas-view') ?? '{}')).toMatchObject({ zoom: 1, auto: false });
  });
});
