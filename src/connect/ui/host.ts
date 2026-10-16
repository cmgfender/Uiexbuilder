/**
 * Which screen reports sign-in results. Normally the top-bar Connect button does (result dialog,
 * "Connected to …" toast). While another screen runs the sign-in itself and shows the outcome in
 * place (the guided setup's Connect step), it sets `inline` so the button stays quiet.
 */
import { create } from 'zustand';

export const useConnectUiHost = create<{ inline: boolean }>(() => ({ inline: false }));

export function setConnectResultsInline(inline: boolean): void {
  if (useConnectUiHost.getState().inline !== inline) useConnectUiHost.setState({ inline });
}
